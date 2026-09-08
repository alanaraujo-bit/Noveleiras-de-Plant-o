import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as abrirDialogo } from "@tauri-apps/plugin-dialog";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import "./estilo.css";

/**
 * A tela de configuração.
 *
 * É a única tela, e responde a duas perguntas: está no ar? e, se não está, o
 * que falta? Todo o resto do dia a dia acontece na bandeja — esta janela existe
 * para o primeiro uso e para quando algo dá errado.
 */

type Estado = "parado" | "noar" | "reiniciando" | "desistiu" | "incompleto";

interface Config {
  biblioteca: string;
  painel: string;
  slug: string;
  segredo: string;
  porta: number;
}

interface Situacao {
  config: Config;
  estado: Estado;
  rotulo: string;
  erro: string | null;
  faltando: string[];
}

const $ = <T extends HTMLElement = HTMLElement>(s: string): T => {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`elemento ${s} não existe`);
  return el;
};

const campo = (s: string) => $<HTMLInputElement>(s);

function preencher(c: Config) {
  campo("#biblioteca").value = c.biblioteca;
  campo("#painel").value = c.painel;
  campo("#slug").value = c.slug;
  campo("#segredo").value = c.segredo;
  campo("#porta").value = String(c.porta);
}

/**
 * Traz a configuração do projeto.
 *
 * Sem caminho, o Rust procura sozinho nos lugares prováveis; achando, isto
 * vira um clique. Só pede o arquivo quando a busca falha — pedir antes seria
 * trabalho que quase sempre não precisava existir.
 */
async function importar(caminho?: string) {
  const aviso = $("#aviso");
  try {
    const c = await invoke<Config>("importar", { caminho: caminho ?? null });
    preencher(c);
    await salvar();
  } catch (e) {
    if (!caminho) {
      const escolha = await abrirDialogo({
        multiple: false,
        title: "Escolha o .env.agente do projeto",
      });
      if (typeof escolha === "string") return importar(escolha);
    }
    aviso.textContent = String(e);
    aviso.className = "aviso ruim";
    aviso.hidden = false;
  }
}

async function carregar() {
  const s = await invoke<Situacao>("situacao");

  $("#ponto").className = `ponto e-${s.estado}`;
  $("#estado").textContent = s.rotulo;
  // O atalho só faz sentido enquanto falta configurar; depois vira ruído.
  $("#atalho").hidden = s.faltando.length === 0;

  const aviso = $("#aviso");
  // A ordem importa: um erro concreto ("porta ocupada") ajuda mais que a lista
  // genérica do que falta preencher.
  if (s.erro) {
    aviso.textContent = s.erro;
    aviso.className = "aviso ruim";
    aviso.hidden = false;
  } else if (s.faltando.length) {
    aviso.textContent = `Para começar, use Importar acima — ou preencha ${s.faltando.join(" e ")}.`;
    aviso.className = "aviso";
    aviso.hidden = false;
  } else {
    aviso.hidden = true;
  }

  // Não sobrescreve o que a pessoa está digitando: recarregar por causa de um
  // evento do agente não pode apagar meio formulário preenchido.
  if (document.activeElement?.tagName !== "INPUT") preencher(s.config);
}

async function salvar() {
  const config: Config = {
    biblioteca: campo("#biblioteca").value.trim(),
    painel: campo("#painel").value.trim() || "http://localhost:3100",
    slug: campo("#slug").value.trim(),
    segredo: campo("#segredo").value,
    porta: Number(campo("#porta").value) || 8099,
  };
  try {
    await invoke("salvar", { config });
  } catch (e) {
    const aviso = $("#aviso");
    aviso.textContent = String(e);
    aviso.className = "aviso ruim";
    aviso.hidden = false;
  }
  await carregar();
}

$("#procurar").addEventListener("click", async () => {
  const escolha = await abrirDialogo({ directory: true, multiple: false });
  if (typeof escolha === "string") campo("#biblioteca").value = escolha;
});

$("#importar").addEventListener("click", () => void importar());
$("#salvar").addEventListener("click", salvar);
$("#ligar").addEventListener("click", async () => {
  await invoke("ligar");
  await carregar();
});
$("#desligar").addEventListener("click", async () => {
  await invoke("desligar");
  await carregar();
});

$("#registro-abrir").addEventListener("click", async () => {
  const linhas = await invoke<string[]>("registro");
  const corpo = $("#registro-corpo");
  corpo.textContent = linhas.length ? linhas.join("\n") : "sem nada registrado ainda";
  $("#registro").hidden = false;
  // O que interessa é o fim: é onde está o motivo da falha.
  corpo.scrollTop = corpo.scrollHeight;
});
$("#registro-fechar").addEventListener("click", () => ($("#registro").hidden = true));

const auto = campo("#autostart");
isEnabled()
  .then((v) => (auto.checked = v))
  .catch(() => {});
auto.addEventListener("change", async () => {
  try {
    await (auto.checked ? enable() : disable());
  } catch {
    auto.checked = !auto.checked;
  }
});

// O agente avisa quando muda de estado, inclusive quando cai sozinho.
void listen("agente://estado", () => void carregar());
void carregar();
