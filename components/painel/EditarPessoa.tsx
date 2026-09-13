"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editarPessoa } from "@/lib/painel/acoes/elenco";
import { initials } from "@/lib/text";
import { Bloco, BotaoPainel } from "@/components/painel/primitivos";

const campo = "mt-2 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-3 py-2 text-[0.8125rem] text-[var(--p-texto)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--p-acento)] disabled:opacity-60";

export function EditarPessoa({ pessoa, podeEditar }: {
  pessoa: { id: string; nome: string; biografia: string; fotoUrl: string | null }; podeEditar: boolean;
}) {
  const router = useRouter();
  const arquivo = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState(pessoa.nome);
  const [biografia, setBiografia] = useState(pessoa.biografia);
  const [foto, setFoto] = useState(pessoa.fotoUrl);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();

  function salvarFoto(file?: File) {
    setErro(""); setMensagem("");
    if (file && file.size > 5 * 1024 * 1024) { setErro("A foto deve ter no máximo 5 MB."); return; }
    iniciar(async () => {
      try {
        const body = new FormData();
        if (file) body.set("foto", file);
        const resposta = await fetch(`/api/painel/elenco/${pessoa.id}/foto`, { method: file ? "POST" : "DELETE", ...(file ? { body } : {}) });
        const resultado = await resposta.json();
        if (!resposta.ok || !resultado.ok) { setErro(resultado.erro ?? "Não foi possível salvar a foto."); return; }
        setFoto(resultado.fotoUrl ?? null);
        setMensagem(file ? "Foto atualizada." : "Foto removida.");
        router.refresh();
      } catch { setErro("Não foi possível salvar a foto. Confira a conexão e tente de novo."); }
      finally { if (arquivo.current) arquivo.current.value = ""; }
    });
  }

  return <Bloco titulo="Foto e biografia" descricao="Use uma foto identificada da pessoa e informações verificadas sobre sua carreira.">
    <div className="flex flex-wrap items-center gap-4">
      <span aria-hidden className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--p-elevado)] text-xl text-[var(--p-suave)]">
        {foto ? <img src={foto} alt="" width={80} height={80} className="size-full object-cover" /> : initials(nome)}
      </span>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <BotaoPainel type="button" disabled={!podeEditar || pendente} onClick={() => arquivo.current?.click()}>{foto ? "Trocar foto" : "Adicionar foto"}</BotaoPainel>
          {foto ? <BotaoPainel type="button" disabled={!podeEditar || pendente} onClick={() => salvarFoto()}>Remover foto</BotaoPainel> : null}
        </div>
        <input ref={arquivo} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Foto da pessoa" className="hidden" disabled={!podeEditar || pendente} onChange={(event) => { const file = event.target.files?.[0]; if (file) salvarFoto(file); }} />
        <p className="text-[0.75rem] text-[var(--p-fraco)]">JPG, PNG ou WebP, até 5 MB. A foto será recortada em quadrado.</p>
      </div>
    </div>
    <form className="mt-6 max-w-2xl space-y-5" onSubmit={(event) => {
      event.preventDefault(); setErro(""); setMensagem("");
      iniciar(async () => {
        try {
          const resultado = await editarPessoa({ personId: pessoa.id, nome, biografia });
          if (resultado.ok) { setMensagem(resultado.mensagem); router.refresh(); }
          else setErro(resultado.erro);
        } catch { setErro("Não foi possível salvar. Confira a conexão e tente de novo."); }
      });
    }}>
      <label className="block text-[0.8125rem] font-semibold text-[var(--p-texto)]">Nome
        <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={120} disabled={!podeEditar || pendente} />
      </label>
      <label className="block text-[0.8125rem] font-semibold text-[var(--p-texto)]">Biografia
        <textarea className={`${campo} min-h-40 resize-y font-normal`} value={biografia} onChange={(e) => setBiografia(e.target.value)} maxLength={2000} disabled={!podeEditar || pendente} aria-describedby="nota-biografia" />
        <span id="nota-biografia" className="mt-1 block text-[0.75rem] font-normal text-[var(--p-fraco)]">{biografia.length}/2.000 caracteres. Se ficar em branco, a biografia não aparece no app.</span>
      </label>
      {!podeEditar ? <p className="text-[0.8125rem] text-[var(--p-suave)]">Seu acesso permite consultar esta ficha. A edição exige permissão de catálogo.</p> : <BotaoPainel type="submit" variante="principal" disabled={pendente}>{pendente ? "Salvando…" : "Salvar alterações"}</BotaoPainel>}
    </form>
    {erro ? <p role="alert" className="mt-4 text-[0.8125rem] text-[var(--p-perigo)]">{erro}</p> : null}
    <p role="status" className="mt-4 text-[0.8125rem] text-[var(--p-suave)]">{mensagem}</p>
  </Bloco>;
}
