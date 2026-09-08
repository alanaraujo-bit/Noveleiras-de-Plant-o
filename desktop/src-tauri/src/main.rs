// A janela e opcional: o app vive na bandeja. Sem o subsystem "windows" um
// console preto apareceria atras dela em toda abertura.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    noveleiras_agente_lib::run()
}
