//! O que esta máquina precisa saber para servir a biblioteca.
//!
//! Fica em `%APPDATA%`, e não junto do executável: a pasta de instalação é
//! comum a todos os usuários e pode ser somente-leitura, enquanto a
//! configuração é de quem usa e sobrevive a reinstalar o aplicativo.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Pasta onde as novelas ficam. É o que o varredor lê e o servidor entrega.
    #[serde(default)]
    pub biblioteca: String,
    /// Endereço do painel administrativo.
    #[serde(default = "painel_padrao")]
    pub painel: String,
    /// Identificação desta máquina no painel, dada por `npm run servidor`.
    #[serde(default)]
    pub slug: String,
    /// Segredo pareado com o slug. Aparece uma vez, no registro do servidor.
    #[serde(default)]
    pub segredo: String,
    #[serde(default = "porta_padrao")]
    pub porta: u16,
}

fn painel_padrao() -> String {
    "http://localhost:3100".into()
}

fn porta_padrao() -> u16 {
    8099
}

impl Default for Config {
    fn default() -> Self {
        Self {
            biblioteca: String::new(),
            painel: painel_padrao(),
            slug: String::new(),
            segredo: String::new(),
            porta: porta_padrao(),
        }
    }
}

impl Config {
    /// Falta alguma coisa para o agente subir inteiro?
    ///
    /// Devolver a lista, e não um booleano, é o que permite a tela dizer
    /// exatamente o que preencher em vez de um "configuração inválida".
    pub fn faltando(&self) -> Vec<&'static str> {
        let mut faltas = Vec::new();
        if self.biblioteca.trim().is_empty() {
            faltas.push("a pasta da biblioteca");
        } else if !PathBuf::from(&self.biblioteca).is_dir() {
            faltas.push("a pasta da biblioteca (o caminho não existe)");
        }
        if self.slug.trim().is_empty() {
            faltas.push("o nome desta máquina no painel");
        }
        if self.segredo.trim().is_empty() {
            faltas.push("o segredo desta máquina");
        }
        faltas
    }

    /// Só a biblioteca já permite servir vídeo, mesmo sem o painel conhecer
    /// esta máquina. Serve para não deixar tudo parado por uma credencial.
    pub fn serve_video(&self) -> bool {
        !self.biblioteca.trim().is_empty() && PathBuf::from(&self.biblioteca).is_dir()
    }
}

/// Lê um `.env` do projeto e monta a configuração a partir dele.
///
/// Existe porque a alternativa era digitar um segredo à mão — e um segredo
/// digitado errado falha em silêncio, com o agente subindo e o painel nunca
/// reconhecendo a máquina. Os dados já existem no projeto; pedi-los de novo
/// seria burocracia pura.
pub fn de_env(texto: &str) -> Config {
    let mut c = Config::default();
    for linha in texto.lines() {
        let linha = linha.trim();
        if linha.is_empty() || linha.starts_with('#') {
            continue;
        }
        let Some((chave, valor)) = linha.split_once('=') else { continue };
        // As aspas fazem parte do formato do arquivo, não do valor.
        let valor = valor.trim().trim_matches(['"', '\'']).to_string();
        if valor.is_empty() {
            continue;
        }
        match chave.trim() {
            "AGENTE_SLUG" => c.slug = valor,
            "AGENTE_SEGREDO" => c.segredo = valor,
            "AGENTE_DESTINO" => c.painel = valor,
            "BIBLIOTECA_RAIZ" => c.biblioteca = valor,
            "MIDIA_PORTA" => {
                if let Ok(p) = valor.parse() {
                    c.porta = p;
                }
            }
            _ => {}
        }
    }
    c
}

/// Procura um `.env.agente` nos lugares onde o projeto costuma estar.
///
/// Vale a tentativa porque acerta na primeira vez em quase todo caso, e
/// quando erra não custa nada: a tela continua pedindo o arquivo.
pub fn procurar_env() -> Option<PathBuf> {
    let mut candidatos: Vec<PathBuf> = Vec::new();
    if let Some(perfil) = std::env::var_os("USERPROFILE") {
        let p = PathBuf::from(&perfil);
        candidatos.push(p.join("Documents").join("Noveleiras de Plantão"));
        candidatos.push(p.join("Noveleiras de Plantão"));
    }
    for raiz in ["C:", "D:", "E:"] {
        for pasta in ["PROJETOS", "Projetos", "projetos", "dev", "Dev"] {
            candidatos.push(PathBuf::from(format!("{raiz}/{pasta}/Noveleiras de Plantão")));
        }
    }
    candidatos
        .into_iter()
        .map(|p| p.join(".env.agente"))
        .find(|p| p.is_file())
}

fn arquivo(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("config.json"))
}

pub fn ler(app: &tauri::AppHandle) -> Config {
    arquivo(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Grava de forma atômica: um corte de energia no meio não pode deixar um
/// `config.json` pela metade, que na próxima abertura viraria "não
/// configurado" e apagaria o que a pessoa preencheu.
pub fn gravar(app: &tauri::AppHandle, c: &Config) -> anyhow::Result<()> {
    let destino = arquivo(app).ok_or_else(|| anyhow::anyhow!("sem pasta de configuração"))?;
    let tmp = destino.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(c)?)?;
    std::fs::rename(&tmp, &destino)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diz_exatamente_o_que_falta() {
        let vazia = Config::default();
        let faltas = vazia.faltando();
        assert_eq!(faltas.len(), 3, "biblioteca, slug e segredo");
        assert!(!vazia.serve_video());
    }

    /// Caminho preenchido mas inexistente é pior que vazio: parece configurado
    /// e falha na hora de ler o disco. A mensagem precisa diferenciar.
    #[test]
    fn pasta_inexistente_nao_conta_como_configurada() {
        let c = Config {
            biblioteca: "Z:/nao/existe".into(),
            slug: "casa".into(),
            segredo: "x".into(),
            ..Default::default()
        };
        assert_eq!(c.faltando(), vec!["a pasta da biblioteca (o caminho não existe)"]);
        assert!(!c.serve_video());
    }

    /// Sem credencial o painel não reconhece a máquina, mas o vídeo ainda pode
    /// ser servido — melhor meio no ar que nada no ar.
    #[test]
    fn so_a_biblioteca_ja_permite_servir_video() {
        let c = Config {
            biblioteca: std::env::temp_dir().to_string_lossy().to_string(),
            ..Default::default()
        };
        assert!(c.serve_video());
        assert_eq!(c.faltando().len(), 2, "faltam slug e segredo");
    }

    /// O formato real do `.env.agente`, com aspas e uma chave que não nos diz
    /// respeito no meio.
    #[test]
    fn le_o_env_do_projeto_como_ele_e_escrito() {
        let c = de_env(
            r#"
            # comentário
            AGENTE_SLUG="casa"
            AGENTE_SEGREDO="abc123"
            AGENTE_DESTINO="http://localhost:3100"
            AGENTE_MIDIA="D:/PROJETOS/x/public/media"
            BIBLIOTECA_RAIZ="D:/Noveleiras de Plantão"
            MIDIA_PORTA="8099"
            "#,
        );
        assert_eq!(c.slug, "casa");
        assert_eq!(c.segredo, "abc123");
        assert_eq!(c.painel, "http://localhost:3100");
        assert_eq!(c.biblioteca, "D:/Noveleiras de Plantão");
        assert_eq!(c.porta, 8099);
    }

    /// Um arquivo pela metade não pode zerar o que já valia: chave ausente
    /// mantém o padrão, e porta ilegível não vira zero.
    #[test]
    fn env_incompleto_nao_destroi_os_padroes() {
        let c = de_env("AGENTE_SLUG=\"casa\"\nMIDIA_PORTA=\"abacaxi\"\nVAZIA=\"\"");
        assert_eq!(c.slug, "casa");
        assert_eq!(c.painel, "http://localhost:3100");
        assert_eq!(c.porta, 8099, "porta ilegível mantém o padrão");
        assert!(c.segredo.is_empty());
    }

    #[test]
    fn o_padrao_aponta_para_o_painel_local() {
        let c = Config::default();
        assert_eq!(c.painel, "http://localhost:3100");
        assert_eq!(c.porta, 8099);
    }
}
