//! Sobe e vigia o agente.
//!
//! O agente é um processo Node que vive dentro do instalador, junto com o
//! próprio Node e o ffmpeg — nada aqui depende de o computador ter Node
//! instalado nem de a pasta do projeto existir. É o que separa "um sistema
//! instalado" de "um comando que alguém precisa lembrar de rodar".
//!
//! Duas regras que vieram de erro observado, não de teoria:
//!
//! - **Parada pedida nunca reinicia.** É o defeito clássico de vigia: a pessoa
//!   manda parar e ele, prestativo, sobe de novo.
//! - **Quem não para de cair, para de tentar.** Porta ocupada e credencial
//!   errada matam o processo no primeiro segundo, sempre. Insistir só gasta
//!   CPU e enche o registro; depois de algumas tentativas ele espera decisão.

use serde::Serialize;
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::config::Config;

/// Teto de linhas guardadas. Um agente rodando por dias produz saída sem fim, e
/// o que interessa quando algo quebra é o final.
const LIMITE_LOG: usize = 500;
const MAX_TENTATIVAS: u32 = 5;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Estado {
    #[default]
    Parado,
    NoAr,
    Reiniciando,
    /// Caiu vezes demais seguidas: espera decisão humana.
    Desistiu,
    /// Falta configuração; nem chegou a tentar.
    Incompleto,
}

/// Quanto esperar antes da próxima tentativa: dobra, com teto.
pub fn espera_para_tentar(tentativa: u32) -> Duration {
    Duration::from_secs((1u64 << tentativa.min(5)).min(30))
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Decisao {
    Aceitar,
    Reiniciar,
    Desistir,
}

pub fn decidir(parada_pedida: bool, tentativas: u32) -> Decisao {
    if parada_pedida {
        Decisao::Aceitar
    } else if tentativas >= MAX_TENTATIVAS {
        Decisao::Desistir
    } else {
        Decisao::Reiniciar
    }
}

#[derive(Default)]
struct Interno {
    estado: Estado,
    erro: Option<String>,
    log: VecDeque<String>,
    filho: Option<tokio::process::Child>,
}

pub struct Agente {
    interno: Mutex<Interno>,
    parada: Arc<AtomicBool>,
    geracao: Arc<AtomicU32>,
}

impl Default for Agente {
    fn default() -> Self {
        Self {
            interno: Mutex::new(Interno::default()),
            parada: Arc::new(AtomicBool::new(false)),
            geracao: Arc::new(AtomicU32::new(0)),
        }
    }
}

impl Agente {
    pub fn estado(&self) -> Estado {
        self.interno.lock().unwrap().estado
    }

    pub fn erro(&self) -> Option<String> {
        self.interno.lock().unwrap().erro.clone()
    }

    pub fn log(&self) -> Vec<String> {
        self.interno.lock().unwrap().log.iter().cloned().collect()
    }

    fn anotar(&self, linha: String) {
        let mut i = self.interno.lock().unwrap();
        if i.log.len() >= LIMITE_LOG {
            i.log.pop_front();
        }
        i.log.push_back(linha);
    }

    fn marcar(&self, estado: Estado, erro: Option<String>) {
        let mut i = self.interno.lock().unwrap();
        i.estado = estado;
        i.erro = erro;
    }
}

/// Onde moram o Node, o ffmpeg e os arquivos do agente dentro do instalado.
struct Pecas {
    node: std::path::PathBuf,
    ffmpeg: std::path::PathBuf,
    entrada: std::path::PathBuf,
}

/// Tira o prefixo `\\?\` de um caminho do Windows.
///
/// O Tauri devolve a pasta de recursos nessa forma estendida, e o Rust lida
/// com ela sem reclamar — `is_file()` diz que o arquivo existe. O Node, não:
/// ele lê `\\?\C:\...` como um caminho de rede cujo servidor é `?` e cujo
/// compartilhamento é `C:`, tenta consultar `C:` como se fosse arquivo e morre
/// com `EISDIR: illegal operation on a directory, lstat 'C:'`.
///
/// O sintoma é cruel porque tudo do lado do Rust parece certo: o arquivo
/// existe, o processo nasce, e só o Node sabe que o caminho é impossível.
pub fn sem_prefixo_estendido(p: &std::path::Path) -> std::path::PathBuf {
    let texto = p.to_string_lossy();
    match texto.strip_prefix(r"\\?\") {
        // `\\?\UNC\servidor\share` volta a ser `\\servidor\share`; o resto é
        // um caminho comum de disco.
        Some(resto) => match resto.strip_prefix("UNC\\") {
            Some(rede) => std::path::PathBuf::from(format!(r"\\{rede}")),
            None => std::path::PathBuf::from(resto),
        },
        None => p.to_path_buf(),
    }
}

/// Resolve as peças ao lado do executável.
///
/// O segundo candidato cobre o desenvolvimento, em que o binário nasce em
/// `target/debug` e os recursos ficam um nível acima.
fn pecas(app: &tauri::AppHandle) -> anyhow::Result<Pecas> {
    use tauri::Manager;
    let exe = std::env::current_exe()?;
    let dir = exe.parent().ok_or_else(|| anyhow::anyhow!("executável sem pasta"))?;
    let node = ["node.exe", "node"]
        .iter()
        .map(|n| dir.join(n))
        .find(|p| p.is_file())
        .ok_or_else(|| anyhow::anyhow!("não achei o Node junto do aplicativo; reinstale"))?;
    let ffmpeg = ["ffmpeg.exe", "ffmpeg"]
        .iter()
        .map(|n| dir.join(n))
        .find(|p| p.is_file())
        .ok_or_else(|| anyhow::anyhow!("não achei o ffmpeg junto do aplicativo; reinstale"))?;

    let recursos = app
        .path()
        .resource_dir()
        .map_err(|_| anyhow::anyhow!("sem pasta de recursos"))?;
    let entrada = recursos.join("agente").join("scripts").join("agente.mjs");
    if !entrada.is_file() {
        anyhow::bail!("não achei o agente junto do aplicativo; reinstale");
    }
    Ok(Pecas {
        node: sem_prefixo_estendido(&node),
        ffmpeg: sem_prefixo_estendido(&ffmpeg),
        entrada: sem_prefixo_estendido(&entrada),
    })
}

fn nascer(app: &tauri::AppHandle, c: &Config) -> anyhow::Result<tokio::process::Child> {
    let p = pecas(app)?;
    let mut cmd = tokio::process::Command::new(&p.node);
    cmd.arg(&p.entrada)
        .current_dir(p.entrada.parent().unwrap_or(&p.entrada))
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // A configuração viaja por ambiente: o agente já lia daí quando era
        // comando de terminal, então nada nele precisou mudar de forma.
        .env("BIBLIOTECA_RAIZ", &c.biblioteca)
        .env("MIDIA_PORTA", c.porta.to_string())
        .env("AGENTE_DESTINO", &c.painel)
        .env("AGENTE_SLUG", &c.slug)
        .env("AGENTE_SEGREDO", &c.segredo)
        .env("FFMPEG_BIN", &p.ffmpeg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Sem isto um console preto pisca a cada subida — inclusive na que
        // acontece sozinha ao ligar o computador.
        cmd.as_std_mut().creation_flags(0x0800_0000);
    }
    Ok(cmd.spawn()?)
}

/// Liga o agente e passa a vigiá-lo.
pub fn iniciar(app: &tauri::AppHandle, agente: Arc<Agente>, c: Config, avisar: impl Fn(Estado) + Send + 'static) {
    let faltas = c.faltando();
    if !c.serve_video() {
        agente.marcar(
            Estado::Incompleto,
            Some(format!("falta {}", faltas.join(", "))),
        );
        avisar(Estado::Incompleto);
        return;
    }
    if matches!(agente.estado(), Estado::NoAr | Estado::Reiniciando) {
        return;
    }
    agente.parada.store(false, Ordering::SeqCst);
    let geracao = agente.geracao.fetch_add(1, Ordering::SeqCst) + 1;
    agente.marcar(Estado::NoAr, None);
    avisar(Estado::NoAr);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut tentativas = 0u32;
        loop {
            if agente.geracao.load(Ordering::SeqCst) != geracao {
                return;
            }
            let mut filho = match nascer(&app, &c) {
                Ok(f) => f,
                Err(e) => {
                    agente.anotar(format!("[app] não consegui iniciar: {e}"));
                    agente.marcar(Estado::Desistiu, Some(e.to_string()));
                    avisar(Estado::Desistiu);
                    return;
                }
            };
            encaminhar(agente.clone(), filho.stdout.take());
            encaminhar(agente.clone(), filho.stderr.take());
            {
                let mut i = agente.interno.lock().unwrap();
                i.filho = None; // o filho vive nesta tarefa; `parar` mata pelo id
                let _ = &mut i;
            }

            let saida = filho.wait().await;
            if agente.parada.load(Ordering::SeqCst) {
                return;
            }
            tentativas += 1;
            let motivo = match saida.ok().and_then(|s| s.code()) {
                Some(c) => format!("o agente encerrou com código {c}"),
                None => "o agente foi interrompido".to_string(),
            };
            agente.anotar(format!("[app] {motivo}"));

            match decidir(false, tentativas) {
                Decisao::Aceitar => return,
                Decisao::Desistir => {
                    agente.marcar(Estado::Desistiu, Some(motivo));
                    avisar(Estado::Desistiu);
                    return;
                }
                Decisao::Reiniciar => {
                    let espera = espera_para_tentar(tentativas);
                    agente.marcar(Estado::Reiniciando, Some(motivo));
                    avisar(Estado::Reiniciando);
                    agente.anotar(format!("[app] tentando de novo em {}s", espera.as_secs()));
                    tokio::time::sleep(espera).await;
                    if agente.parada.load(Ordering::SeqCst) {
                        return;
                    }
                    agente.marcar(Estado::NoAr, None);
                    avisar(Estado::NoAr);
                }
            }
        }
    });
}

pub async fn parar(agente: Arc<Agente>) {
    agente.parada.store(true, Ordering::SeqCst);
    agente.geracao.fetch_add(1, Ordering::SeqCst);
    let filho = agente.interno.lock().unwrap().filho.take();
    if let Some(mut f) = filho {
        let _ = f.kill().await;
        let _ = f.wait().await;
    }
    agente.marcar(Estado::Parado, None);
}

fn encaminhar<L>(agente: Arc<Agente>, saida: Option<L>)
where
    L: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let Some(saida) = saida else { return };
    tauri::async_runtime::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut linhas = tokio::io::BufReader::new(saida).lines();
        while let Ok(Some(linha)) = linhas.next_line().await {
            agente.anotar(linha);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parada pedida é ponto final. Sem isto o "Sair" vira um botão que não
    /// funciona: o vigia sobe de novo o que a pessoa acabou de desligar.
    #[test]
    fn parar_a_pedido_nunca_reinicia() {
        assert_eq!(decidir(true, 0), Decisao::Aceitar);
        assert_eq!(decidir(true, 99), Decisao::Aceitar);
    }

    #[test]
    fn queda_reinicia_ate_um_limite() {
        assert_eq!(decidir(false, 0), Decisao::Reiniciar);
        assert_eq!(decidir(false, MAX_TENTATIVAS - 1), Decisao::Reiniciar);
        assert_eq!(decidir(false, MAX_TENTATIVAS), Decisao::Desistir);
    }

    #[test]
    fn a_espera_cresce_e_para_de_crescer() {
        assert_eq!(espera_para_tentar(0), Duration::from_secs(1));
        assert_eq!(espera_para_tentar(4), Duration::from_secs(16));
        assert_eq!(espera_para_tentar(u32::MAX), Duration::from_secs(30));
    }

    /// O registro é janela deslizante, e o que sobra é o fim — onde está o
    /// motivo da falha.
    #[test]
    fn o_registro_guarda_o_fim_e_nao_cresce_sem_limite() {
        let a = Agente::default();
        for i in 0..(LIMITE_LOG + 50) {
            a.anotar(format!("linha {i}"));
        }
        let log = a.log();
        assert_eq!(log.len(), LIMITE_LOG);
        assert_eq!(log.last().unwrap(), &format!("linha {}", LIMITE_LOG + 49));
    }

    #[test]
    fn comeca_parado() {
        assert_eq!(Agente::default().estado(), Estado::Parado);
    }

    /// O caminho estendido do Windows precisa virar caminho comum antes de ir
    /// para o Node. Passar `\\?\C:\...` produz `EISDIR ... lstat 'C:'`, e o
    /// agente reinicia para sempre sem nunca subir.
    #[test]
    fn tira_o_prefixo_estendido_do_windows() {
        use std::path::Path;
        assert_eq!(
            sem_prefixo_estendido(Path::new(r"\\?\C:\Users\x\Noveleiras\agente\scripts\agente.mjs")),
            Path::new(r"C:\Users\x\Noveleiras\agente\scripts\agente.mjs")
        );
    }

    /// Caminho de rede na forma estendida volta a ser `\\servidor\share`, e não
    /// vira `UNC\servidor\share`, que não existe.
    #[test]
    fn caminho_de_rede_volta_a_forma_normal() {
        use std::path::Path;
        assert_eq!(
            sem_prefixo_estendido(Path::new(r"\\?\UNC\servidor\midia\agente.mjs")),
            Path::new(r"\\servidor\midia\agente.mjs")
        );
    }

    /// Um caminho que já é comum passa intacto: a limpeza não pode inventar
    /// transformação onde não há prefixo.
    #[test]
    fn caminho_comum_passa_intacto() {
        use std::path::Path;
        let p = Path::new(r"D:\PROJETOS\x\scripts\agente.mjs");
        assert_eq!(sem_prefixo_estendido(p), p);
    }
}
