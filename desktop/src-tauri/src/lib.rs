//! Noveleiras — o programa que mantém a biblioteca no ar nesta máquina.
//!
//! Existe por uma limitação que não tem contorno: uma página web não inicia
//! processo no computador de ninguém. O painel administrativo pode pedir uma
//! varredura, mas alguém precisa estar do lado de cá para ler o disco. Esse
//! alguém é este programa.
//!
//! Ele se comporta como se espera de um serviço de mídia caseiro: instala,
//! sobe junto com o Windows, fica na bandeja e desliga pelo botão direito. O
//! trabalho de verdade é feito por um agente Node que viaja dentro do
//! instalador — junto com o próprio Node e o ffmpeg —, de modo que a máquina
//! não precisa ter nada instalado e a pasta do projeto não precisa existir.

mod agente;
mod config;

use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};

use agente::{Agente, Estado};
use config::Config;

type Res<T> = Result<T, String>;

struct Estado0 {
    agente: Arc<Agente>,
}

// ------------------------------------------------------------------- bandeja

fn rotulo(estado: Estado) -> &'static str {
    match estado {
        Estado::NoAr => "no ar",
        Estado::Parado => "desligado",
        Estado::Reiniciando => "reiniciando",
        Estado::Desistiu => "parou — precisa de atenção",
        Estado::Incompleto => "falta configurar",
    }
}

fn atualizar_bandeja(app: &AppHandle) {
    let Some(st) = app.try_state::<Estado0>() else { return };
    let estado = st.agente.estado();
    if let Some(tray) = app.tray_by_id("principal") {
        let _ = tray.set_tooltip(Some(&format!("Noveleiras — {}", rotulo(estado))));
    }
}

fn anunciar(app: &AppHandle, estado: Estado) {
    let _ = app.emit("agente://estado", serde_json::json!({ "estado": estado }));
    atualizar_bandeja(app);

    // Falha ganha aviso do sistema: o programa vive na bandeja, e sem isso um
    // agente que morreu de madrugada só seria notado quando algo não
    // funcionasse — que é exatamente o que se quer evitar.
    if estado != Estado::Desistiu {
        return;
    }
    use tauri_plugin_notification::NotificationExt;
    let motivo = app
        .try_state::<Estado0>()
        .and_then(|s| s.agente.erro())
        .unwrap_or_else(|| "Abra o Noveleiras para ver o registro.".into());
    let _ = app
        .notification()
        .builder()
        .title("Noveleiras parou")
        .body(motivo)
        .show();
}

fn abrir_janela(app: &AppHandle) {
    if let Some(j) = app.get_webview_window("main") {
        let _ = j.show();
        let _ = j.set_focus();
    }
}

// ------------------------------------------------------------------ comandos

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Situacao {
    config: Config,
    estado: Estado,
    rotulo: String,
    erro: Option<String>,
    faltando: Vec<String>,
}

#[tauri::command]
fn situacao(app: AppHandle, st: State<'_, Estado0>) -> Situacao {
    let c = config::ler(&app);
    let estado = st.agente.estado();
    Situacao {
        faltando: c.faltando().into_iter().map(String::from).collect(),
        config: c,
        estado,
        rotulo: rotulo(estado).into(),
        erro: st.agente.erro(),
    }
}

#[tauri::command]
async fn salvar(app: AppHandle, st: State<'_, Estado0>, config: Config) -> Res<()> {
    config::gravar(&app, &config).map_err(|e| e.to_string())?;
    // Trocar a pasta ou a credencial só vale depois de o agente renascer com
    // elas; religar aqui evita a pergunta "salvei, e agora?".
    agente::parar(st.agente.clone()).await;
    let h = app.clone();
    agente::iniciar(&app, st.agente.clone(), config, move |e| anunciar(&h, e));
    Ok(())
}

#[tauri::command]
fn ligar(app: AppHandle, st: State<'_, Estado0>) {
    let c = config::ler(&app);
    let h = app.clone();
    agente::iniciar(&app, st.agente.clone(), c, move |e| anunciar(&h, e));
}

#[tauri::command]
async fn desligar(app: AppHandle, st: State<'_, Estado0>) -> Res<()> {
    agente::parar(st.agente.clone()).await;
    anunciar(&app, Estado::Parado);
    Ok(())
}

#[tauri::command]
fn registro(st: State<'_, Estado0>) -> Vec<String> {
    st.agente.log()
}

/// Lê um `.env.agente` e devolve a configuração pronta.
///
/// Sem caminho, procura sozinho nos lugares onde o projeto costuma estar — na
/// maioria das máquinas isso acerta e o primeiro uso vira um clique.
#[tauri::command]
fn importar(caminho: Option<String>) -> Res<Config> {
    let arquivo = match caminho {
        Some(c) => std::path::PathBuf::from(c),
        None => config::procurar_env()
            .ok_or_else(|| "Não achei o .env.agente sozinho. Escolha o arquivo.".to_string())?,
    };
    let texto = std::fs::read_to_string(&arquivo)
        .map_err(|e| format!("não consegui ler {}: {e}", arquivo.display()))?;
    let c = config::de_env(&texto);
    if c.slug.trim().is_empty() && c.segredo.trim().is_empty() {
        return Err("Esse arquivo não tem AGENTE_SLUG nem AGENTE_SEGREDO.".into());
    }
    Ok(c)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Estado0 {
            agente: Arc::new(Agente::default()),
        })
        .setup(|app| {
            let handle = app.handle().clone();

            let abrir = MenuItem::with_id(app, "abrir", "Abrir o Noveleiras", true, None::<&str>)?;
            let painel = MenuItem::with_id(app, "painel", "Abrir painel administrativo", true, None::<&str>)?;
            let religar = MenuItem::with_id(app, "religar", "Religar o agente", true, None::<&str>)?;
            let separador = PredefinedMenuItem::separator(app)?;
            // "Sair" desliga o agente antes de morrer. Encerrar pelo
            // Gerenciador de Tarefas deixaria o Node órfão segurando a porta.
            let sair = MenuItem::with_id(app, "sair", "Sair (desliga tudo)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&abrir, &painel, &religar, &separador, &sair])?;

            let icone = app.default_window_icon().cloned();
            let mut tray = TrayIconBuilder::with_id("principal")
                .menu(&menu)
                .tooltip("Noveleiras")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "abrir" => abrir_janela(app),
                    "painel" => {
                        use tauri_plugin_opener::OpenerExt;
                        let destino = config::ler(app).painel;
                        let _ = app.opener().open_url(destino, None::<&str>);
                    }
                    "religar" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(st) = app.try_state::<Estado0>() {
                                let a = st.agente.clone();
                                agente::parar(a.clone()).await;
                                let c = config::ler(&app);
                                let h = app.clone();
                                agente::iniciar(&app, a, c, move |e| anunciar(&h, e));
                            }
                        });
                    }
                    "sair" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(st) = app.try_state::<Estado0>() {
                                agente::parar(st.agente.clone()).await;
                            }
                            app.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        abrir_janela(tray.app_handle());
                    }
                });
            if let Some(icone) = icone {
                tray = tray.icon(icone);
            }
            tray.build(app)?;

            // Abrir o programa é ligar: é o comportamento que se espera de um
            // serviço de mídia, e é o que dispensa qualquer comando.
            let c = config::ler(&handle);
            let st = handle.state::<Estado0>();
            let h = handle.clone();
            agente::iniciar(&handle, st.agente.clone(), c.clone(), move |e| anunciar(&h, e));

            // Sem configuração a janela precisa aparecer: não há o que fazer
            // em segundo plano, e um ícone silencioso na bandeja não explicaria
            // por que nada funciona.
            if let Some(j) = handle.get_webview_window("main") {
                if c.faltando().is_empty() {
                    let _ = j.hide();
                } else {
                    let _ = j.show();
                }
            }

            // O X esconde; quem encerra é o "Sair" da bandeja.
            if let Some(main) = handle.get_webview_window("main") {
                main.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                    }
                });
                if let Some(j) = handle.get_webview_window("main") {
                    let j2 = j.clone();
                    j.on_window_event(move |e| {
                        if let tauri::WindowEvent::CloseRequested { .. } = e {
                            let _ = j2.hide();
                        }
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![situacao, salvar, ligar, desligar, registro, importar])
        .run(tauri::generate_context!())
        .expect("erro ao rodar o Noveleiras");
}
