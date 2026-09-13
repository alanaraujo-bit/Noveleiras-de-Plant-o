import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/painel/guarda";
import { fotoDoElenco } from "@/lib/media/fotos-elenco";
import { initials } from "@/lib/text";
import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { BarraDeFiltros, CampoDeBusca, Paginacao, Seletor } from "@/components/painel/Filtros";
import { Tabela, Td, Th, Vazio } from "@/components/painel/primitivos";

export const metadata = { title: "Elenco" };

export default async function Elenco({ searchParams }: {
  searchParams: Promise<{ q?: string; pagina?: string; falta?: string }>;
}) {
  await exigirPermissao("catalogo.ver");
  const params = await searchParams;
  const termo = params.q?.trim().slice(0, 120);
  const where: Prisma.PersonWhereInput = {
    ...(termo ? { name: { contains: termo, mode: "insensitive" } } : {}),
    ...(params.falta === "foto" ? { photoKey: null } : {}),
    ...(params.falta === "bio" ? { bio: "" } : {}),
  };
  const total = await db.person.count({ where });
  const paginas = Math.max(1, Math.ceil(total / 30));
  const numero = Number(params.pagina);
  const pagina = Number.isSafeInteger(numero) ? Math.min(paginas, Math.max(1, numero)) : 1;
  const pessoas = await db.person.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (pagina - 1) * 30, take: 30,
    select: { id: true, slug: true, name: true, bio: true, photoKey: true, _count: { select: { novelas: true } } },
  });
  return <>
    <Cabecalho titulo="Elenco" descricao="Fotos, biografias e novelas de cada pessoa." />
    <Conteudo>
      <section className="painel-cartao overflow-hidden">
        <BarraDeFiltros>
          <CampoDeBusca placeholder="Buscar pelo nome…" />
          <Seletor chave="falta" rotulo="Filtrar informações pendentes" opcoes={[
            { valor: "", rotulo: "Todas as pessoas" }, { valor: "foto", rotulo: "Sem foto" }, { valor: "bio", rotulo: "Sem biografia" },
          ]} />
        </BarraDeFiltros>
        {pessoas.length ? <Tabela cabecalho={<tr><Th>Pessoa</Th><Th>Novelas</Th><Th>Informações</Th><Th><span className="sr-only">Abrir</span></Th></tr>}>
          {pessoas.map((pessoa) => {
            const foto = fotoDoElenco(pessoa.slug, pessoa.photoKey);
            return <tr key={pessoa.id}>
              <Td><Link href={`/painel/elenco/${pessoa.id}`} className="flex items-center gap-3 font-semibold hover:underline">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--p-elevado)] text-[var(--p-suave)]">
                  {foto ? <img src={foto} alt="" width={40} height={40} className="size-full object-cover" /> : initials(pessoa.name)}
                </span>{pessoa.name}
              </Link></Td>
              <Td>{pessoa._count.novelas}</Td>
              <Td>{[!foto && "Sem foto", !pessoa.bio && "Sem biografia"].filter(Boolean).join(" · ") || "Foto e biografia"}</Td>
              <Td><Link href={`/painel/elenco/${pessoa.id}`} className="text-[var(--p-acento)] hover:underline" aria-label={`Abrir ficha de ${pessoa.name}`}>Abrir ficha</Link></Td>
            </tr>;
          })}
        </Tabela> : <Vazio titulo={termo || params.falta ? "Nenhuma pessoa neste filtro" : "Nenhum elenco cadastrado"} descricao={termo || params.falta ? "Tente outro nome ou remova o filtro." : "As pessoas aparecem aqui após importar o elenco das novelas."} />}
        <Paginacao pagina={pagina} paginas={paginas} total={total} rotuloItem="pessoas" />
      </section>
    </Conteudo>
  </>;
}
