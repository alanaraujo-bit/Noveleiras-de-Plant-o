import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConviteConta, PEDIR_CONTA } from "./ConviteConta";
import { EVENTO_VISITANTE } from "@/lib/player/visitante";

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
const props = { episodioId: "ep-7", titulo: "Minha novela", suspenso: false, aoAbrir: vi.fn() };
function assistir(ms = 10000) {
  act(() => { window.dispatchEvent(new CustomEvent(EVENTO_VISITANTE, { detail: { deltaMs: ms } })); });
}

describe("convite contextual para criar conta", () => {
  it("não interrompe a chegada e só convida depois de assistir", () => {
    render(<ConviteConta {...props} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Já se apegou à história?")).toBeNull();
    assistir(); assistir(); assistir();
    expect(screen.queryByText("Já se apegou à história?")).toBeNull();
    assistir();
    expect(screen.getByText("Já se apegou à história?")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("respeita a dispensa mesmo depois de reabrir o app", () => {
    localStorage.setItem("nvl:convite:ultimo", String(Date.now()));
    render(<ConviteConta {...props} />);
    for (let i = 0; i < 10; i++) assistir();
    expect(screen.queryByText("Já se apegou à história?")).toBeNull();
    fireEvent.click(screen.getByText("Salvar meu lugar"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("preserva o episódio no cadastro e distingue conta de conteúdo pago", () => {
    render(<ConviteConta {...props} />);
    act(() => { window.dispatchEvent(new CustomEvent(PEDIR_CONTA, { detail: "limite" })); });
    expect(screen.getByText(/Criar a conta não gera cobrança nem libera/)).toBeInTheDocument();
    const href = screen.getByRole("link", { name: "Criar minha conta grátis" }).getAttribute("href");
    expect(new URL(href!, "http://localhost").searchParams.get("destino")).toBe("/plantao?episodio=ep-7");
    fireEvent.click(screen.getByRole("button", { name: "Fechar e voltar à novela" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
