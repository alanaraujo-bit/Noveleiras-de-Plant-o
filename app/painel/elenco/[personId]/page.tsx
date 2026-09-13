import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fotoDoElenco } from "@/lib/media/fotos-elenco";
import { exigirPermissao } from "@/lib/painel/guarda";
import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, Migalhas } from "@/components/painel/primitivos";
import { EditarPessoa } from "@/components/painel/EditarPessoa";

export const metadata = { title: "Ficha do elenco" };

export default async function Ficha({ params }: { params: Promise<{ personId: string }> }) {
  const operador = await exigirPermissao("catalogo.ver");
  const { personId } = await params;
  const pessoa = await db.person.findUnique({ where: { id: personId },
    include: { novelas: { orderBy: { novela: { title: "asc" } }, select: { role: true, novela: { select: { id: true, title: true, slug: true } } } } },
  });
  if (!pessoa) notFound();
  return <>
    <Cabecalho titulo={pessoa.name} descricao="Informações exibidas na página da pessoa e nas fichas das novelas."
      acoes={<Link href={`/elenco/${pessoa.slug}`} className="text-[0.8125rem] text-[var(--p-acento)] hover:underline">Ver página no app</Link>} />
    <Conteudo className="space-y-5">
      <Migalhas itens={[{ rotulo: "Elenco", href: "/painel/elenco" }, { rotulo: pessoa.name }]} />
      <EditarPessoa key={pessoa.id} pessoa={{ id: pessoa.id, nome: pessoa.name, biografia: pessoa.bio, fotoUrl: fotoDoElenco(pessoa.slug, pessoa.photoKey) }} podeEditar={operador.pode("catalogo.editar")} />
      <Bloco titulo="Novelas no catálogo" descricao={`${pessoa.novelas.length} novela(s) vinculada(s)`}>
        {pessoa.novelas.length ? <ul className="divide-y divide-[var(--p-linha)]">{pessoa.novelas.map(({ novela, role }) => <li key={novela.id} className="py-3 first:pt-0 last:pb-0">
          <Link href={`/painel/catalogo/${novela.id}`} className="text-[0.8125rem] font-semibold text-[var(--p-texto)] hover:underline">{novela.title}</Link>
          {role ? <p className="mt-1 text-[0.75rem] text-[var(--p-suave)]">{role}</p> : null}
        </li>)}</ul> : <p className="text-[0.8125rem] text-[var(--p-suave)]">Nenhuma novela vinculada.</p>}
      </Bloco>
    </Conteudo>
  </>;
}
