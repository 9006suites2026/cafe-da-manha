"use strict";
// =====================================================================
//  CONFIGURAÇÃO DO BANCO (Supabase)
//  Cole a "Project URL" e a chave "Publishable" (ou "anon") do seu projeto.
//  NUNCA cole aqui a chave "secret" / "service_role".
//  Deixando vazio, a página funciona no modo local (dados só neste navegador).
// =====================================================================
const SUPABASE_URL = "https://ljepyqpkpaeghfifafik.supabase.co";
const SUPABASE_KEY = "sb_publishable_sz44cTKPSKpmXHBWuVffWg_rudm3OQi";
// =====================================================================

const CONFIGURADO = !!(SUPABASE_URL && SUPABASE_KEY);
const ONLINE = CONFIGURADO;
const sb = CONFIGURADO && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const EMP = { "9006": "9006 Suites", "madero": "Reserva Madero" };
const KEY = "cafe-hotel-v1";
const DEFAULT_ITENS = [
  { nome: "Pão francês", un: "un", adulto: 2, crianca: 1 },
  { nome: "Pão de queijo", un: "un", adulto: 3, crianca: 2 },
  { nome: "Croissant / folhado", un: "un", adulto: 1, crianca: 0.5 },
  { nome: "Bolo (fatias)", un: "fatia", adulto: 1, crianca: 1 },
  { nome: "Presunto", un: "g", adulto: 40, crianca: 20 },
  { nome: "Queijo mussarela", un: "g", adulto: 40, crianca: 20 },
  { nome: "Leite", un: "ml", adulto: 200, crianca: 250 }
];
const DIAS_HISTORICO = 60; // no modo online, carrega reservas com check-out nos últimos 60 dias em diante

// ---------- dados ----------
function novoDB() { return { reservas: [], avulsos: {}, itens: DEFAULT_ITENS.map(x => ({ ...x })), margem: 10 }; }
function lerLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.reservas)) return Object.assign(novoDB(), d);
  } catch (e) {}
  return null;
}
let db = ONLINE ? novoDB() : (lerLocal() || novoDB());

// ---------- datas ----------
const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const toDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };
const br = s => s ? s.split("-").reverse().join("/") : "";
const brCurto = s => s.slice(8, 10) + "/" + s.slice(5, 7);
const diaSemana = s => toDate(s).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
const dataLonga = s => toDate(s).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
function parseData(t) {
  t = String(t || "").trim();
  let m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return y + "-" + pad(+m[2]) + "-" + pad(+m[1]); }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  return null;
}
const hoje = () => iso(new Date());
let diaSel = addDays(hoje(), 1);

// número seguro para ir ao HTML (dados do banco/backup nunca entram crus na página)
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// Acompanhantes: no banco ficam num texto só ("Ana, João, Bia"); nas telas, um campo por pessoa
const listaAcomp = s => String(s || "").split(/\s*[,;\n]\s*/).map(t => t.trim()).filter(Boolean);
const juntarAcomp = arr => arr.map(t => String(t).trim()).filter(Boolean).join(", ");
// quantos campos mostrar: todos do apto menos o titular (e nunca menos que os nomes já salvos)
const qtdAcomp = (ad, cr, nomes) => Math.min(29, Math.max(num(ad) + num(cr) - 1, nomes.length, 0));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = id => document.getElementById(id);
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
function toast(msg, ms = 2400) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms); }
function setStatus(tipo, txt) { const s = $("status"); s.className = "status " + tipo; s.textContent = txt; }

// ---------- camada de gravação (local ou Supabase) ----------
const okOuErro = r => { if (r && r.error) throw r.error; return r && r.data; };
const linhaReserva = r => ({ id: r.id, emp: r.emp, apto: String(r.apto), hospede: r.hospede || "", acompanhante: r.acompanhante || "", reserva: String(r.reserva || ""), saida_definida: !saidaIncerta(r),
  conferida: !!r.conferida, conferida_em: r.conferida ? (r.conferida_em || null) : null, conferida_por: r.conferida ? String(r.conferida_por || "").slice(0, 200) : "", adultos: +r.adultos || 0, criancas: +r.criancas || 0, checkin: r.checkin, checkout: r.checkout, cafe: !!r.cafe, obs: r.obs || "" });
const linhasExtras = avulsos => Object.entries(avulsos || {}).flatMap(([dia, emps]) => Object.entries(emps || {}).filter(([emp]) => EMP[emp]).map(([emp, v]) => ({ dia, emp, adultos: +v.a || 0, criancas: +v.c || 0 })));

// Grava: no modo local salva no navegador; no online executa fn (chamadas ao Supabase).
async function gravar(fn) {
  if (!ONLINE) { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
  setStatus("wait", "salvando…");
  try { await fn(); setStatus("ok", "online"); return true; }
  catch (e) {
    console.error(e); setStatus("err", "erro ao salvar");
    toast("Não foi possível salvar no banco: " + (e.message || e), 5000);
    agendarRecarga(); return false;
  }
}
async function upsertEmLotes(tabela, linhas, opts) {
  for (let i = 0; i < linhas.length; i += 500) okOuErro(await sb.from(tabela).upsert(linhas.slice(i, i + 500), opts));
}

const Store = {
  salvarReserva: r => gravar(async () => okOuErro(await sb.from("reservas").upsert(linhaReserva(r)))),
  excluirReserva: id => gravar(async () => okOuErro(await sb.from("reservas").delete().eq("id", id))),
  inserirReservas: lista => gravar(() => upsertEmLotes("reservas", lista.map(linhaReserva))),
  salvarExtra: (dia, emp) => gravar(async () => {
    const v = (db.avulsos[dia] || {})[emp] || {};
    okOuErro(await sb.from("extras").upsert({ dia, emp, adultos: +v.a || 0, criancas: +v.c || 0 }, { onConflict: "dia,emp" }));
  }),
  salvarConfig: () => gravar(async () => okOuErro(await sb.from("config").upsert({ id: 1, itens: db.itens, margem: +db.margem || 0 }))),
  // grava o resultado de uma importação de PDF: atualiza/cria estadias e apaga as encerradas sem noites
  aplicarImportacao: (lista, apagar) => gravar(async () => {
    await upsertEmLotes("reservas", lista.map(linhaReserva));
    if (apagar.length) okOuErro(await sb.from("reservas").delete().in("id", apagar));
  }),
  // excluir a relação de um dia de um empreendimento (e desfazer)
  excluirRelacao: (gravarL, apagar, dia, emp) => gravar(async () => {
    if (gravarL.length) await upsertEmLotes("reservas", gravarL.map(linhaReserva));
    if (apagar.length) okOuErro(await sb.from("reservas").delete().in("id", apagar));
    okOuErro(await sb.from("extras").delete().eq("dia", dia).eq("emp", emp));
  }),
  desfazerExclusao: (originais, criados, extra, dia, emp) => gravar(async () => {
    if (criados.length) okOuErro(await sb.from("reservas").delete().in("id", criados));
    if (originais.length) await upsertEmLotes("reservas", originais.map(linhaReserva));
    if (extra) okOuErro(await sb.from("extras").upsert({ dia, emp, adultos: num(extra.a), criancas: num(extra.c) }, { onConflict: "dia,emp" }));
  }),
  apagarAntigas: lim => gravar(async () => {
    okOuErro(await sb.from("reservas").delete().lt("checkout", lim));
    okOuErro(await sb.from("extras").delete().lt("dia", lim));
  }),
  enviarTudo: d => gravar(async () => {
    await upsertEmLotes("reservas", d.reservas.map(linhaReserva));
    await upsertEmLotes("extras", linhasExtras(d.avulsos), { onConflict: "dia,emp" });
    if (Array.isArray(d.itens)) okOuErro(await sb.from("config").upsert({ id: 1, itens: d.itens, margem: +d.margem || 0 }));
  })
};

// ---------- carregar do Supabase ----------
// O Supabase devolve no máximo 1000 linhas por consulta: busca em páginas até acabar
async function buscarTudo(montar) {
  const PAG = 1000, out = [];
  for (let de = 0; ; de += PAG) {
    const { data, error } = await montar().range(de, de + PAG - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < PAG) return out;
  }
}
// Só aceita itens de configuração bem formados (o campo no banco é livre)
const itemValido = i => i && typeof i === "object" && typeof i.nome === "string";
async function carregar() {
  const lim = addDays(hoje(), -DIAS_HISTORICO);
  const [reservas, extras, c] = await Promise.all([
    buscarTudo(() => sb.from("reservas").select("id,emp,apto,reserva,saida_definida,conferida,conferida_em,conferida_por,hospede,acompanhante,adultos,criancas,checkin,checkout,cafe,obs").gte("checkout", lim).order("checkin").order("id")),
    buscarTudo(() => sb.from("extras").select("dia,emp,adultos,criancas").gte("dia", lim).order("dia").order("emp")),
    sb.from("config").select("itens,margem").eq("id", 1).maybeSingle()
  ]);
  if (c.error) throw c.error;
  db.reservas = reservas;
  db.avulsos = {};
  for (const x of extras) (db.avulsos[x.dia] ||= {})[x.emp] = { a: x.adultos, c: x.criancas };
  if (c.data) {
    if (Array.isArray(c.data.itens)) db.itens = c.data.itens.filter(itemValido).map(i => ({ nome: i.nome, un: String(i.un ?? ""), adulto: num(i.adulto), crianca: num(i.crianca) }));
    db.margem = num(c.data.margem);
  }
  renderTudo();
}
let recargaTimer = null;
function agendarRecarga() {
  if (!ONLINE || !sessaoAtiva) return;
  clearTimeout(recargaTimer);
  recargaTimer = setTimeout(async () => {
    try { await carregar(); setStatus("ok", "online"); }
    catch (err) { console.error(err); setStatus("err", "sem conexão"); }
  }, 400);
}

// ---------- regra do café ----------
// Toma café na manhã do dia D quem dormiu a noite anterior: check-in < D <= check-out
// A relação lista TODOS os hospedados da noite anterior; só os "com café" entram na contagem.
const hospedado = (r, dia) => r.checkin < dia && dia <= r.checkout;
// Aptos vindos do PDF: o PDF não traz a data de saída. Enquanto ninguém confirmar a saída,
// o check-out guardado é só "o último dia em que apareceu no PDF".
const doPdf = r => String(r.id).startsWith("pdf-");
const saidaIncerta = r => r.saida_definida === false || (r.saida_definida === undefined && doPdf(r));

function resumo(dia) {
  const emp = {};
  for (const k in EMP) emp[k] = { adultos: 0, criancas: 0, aptos: [], aptosCafe: 0, semCafe: 0, exA: 0, exC: 0 };
  for (const r of db.reservas) {
    if (emp[r.emp] && hospedado(r, dia)) {
      const o = emp[r.emp]; o.aptos.push(r);
      if (r.cafe) { o.adultos += +r.adultos || 0; o.criancas += +r.criancas || 0; o.aptosCafe++; }
      else o.semCafe++;
    }
  }
  const av = db.avulsos[dia] || {};
  let A = 0, C = 0;
  for (const k in EMP) {
    const o = emp[k], a = av[k] || {};
    o.exA = +a.a || 0; o.exC = +a.c || 0;
    o.totA = o.adultos + o.exA; o.totC = o.criancas + o.exC; o.tot = o.totA + o.totC;
    A += o.totA; C += o.totC;
    o.aptos.sort((x, y) => String(x.apto).localeCompare(String(y.apto), "pt-BR", { numeric: true }));
  }
  return { emp, A, C, T: A + C };
}

function pedido(res) {
  const mg = 1 + (+db.margem || 0) / 100;
  return db.itens.filter(i => i.nome && ((+i.adulto || 0) || (+i.crianca || 0)))
    .map(i => ({ nome: i.nome, un: i.un, q: Math.ceil((res.A * (+i.adulto || 0) + res.C * (+i.crianca || 0)) * mg) }));
}
function fmtQ(q, un) {
  const u = String(un || "").toLowerCase();
  if (u === "g" && q >= 1000) return (q / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " kg";
  if (u === "ml" && q >= 1000) return (q / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " L";
  return q.toLocaleString("pt-BR") + " " + (un || "");
}
const pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const pessoas = (a, c) => `${a} adulto${a === 1 ? "" : "s"}${c ? `, ${c} criança${c === 1 ? "" : "s"}` : ""}`;

// ---------- render: relação ----------
function renderRelacao() {
  $("dia").value = diaSel;
  $("diaTitulo").textContent = dataLonga(diaSel);
  const res = resumo(diaSel);

  let w = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(hoje(), i), r = resumo(d);
    const nome = i === 0 ? "hoje" : i === 1 ? "amanhã" : diaSemana(d);
    w += `<div class="day ${d === diaSel ? "sel" : ""}" data-dia="${d}">${nome} ${brCurto(d)}<b>${r.T}</b>pessoas</div>`;
  }
  $("semana").innerHTML = w;

  let s = "";
  for (const k in EMP) {
    const o = res.emp[k];
    s += `<div class="stat e${k}"><div class="lbl">${EMP[k]}</div><div class="n">${o.tot}</div>
      <div class="t">${pessoas(o.totA, o.totC)} · ${pl(o.aptosCafe, "apto")} com café${o.semCafe ? ` · ${o.semCafe} sem café` : ""}${o.exA + o.exC ? ` · +${o.exA + o.exC} extra` : ""}</div></div>`;
  }
  s += `<div class="stat"><div class="lbl">Total do café</div><div class="n">${res.T}</div><div class="t">${pessoas(res.A, res.C)}</div></div>`;
  $("stats").innerHTML = s;

  // não redesenha as listas enquanto alguém digita um extra (evita perder o que está digitando)
  const foco = document.activeElement;
  if (!(foco && foco.dataset && foco.dataset.ex)) {
    let l = "";
    for (const k in EMP) {
      const o = res.emp[k];
      let rows = o.aptos.map(r => `<tr class="${r.conferida ? "conf" : ""}"${r.cafe ? "" : ' style="opacity:.75"'}><td style="white-space:nowrap"><button class="btn-conf${r.conferida ? " ok" : ""} noprint" data-conf="${esc(r.id)}" title="${r.conferida ? "Conferida — clique para desmarcar" : "Marcar como conferida"}" style="padding:1px 7px">${r.conferida ? "✓" : "○"}</button> <b>${esc(r.apto)}</b></td>
        <td>${esc(r.hospede)}${r.reserva ? ` <small style="color:var(--muted)">· Res. ${esc(r.reserva)}</small>` : ""}${listaAcomp(r.acompanhante).map(a => `<br><small>+ ${esc(a)}</small>`).join("")}${r.obs ? `<br><small style="color:var(--muted)">${esc(r.obs)}</small>` : ""}</td>
        <td class="num">${num(r.adultos)}</td><td class="num">${num(r.criancas)}</td>
        <td>${r.cafe ? "" : '<span class="tag no">sem café</span> '}${saidaIncerta(r) ? "" : r.checkout === diaSel ? '<span class="tag out">sai hoje</span>' : "até " + brCurto(r.checkout)}</td></tr>`).join("");
      if (!rows) rows = `<tr><td colspan="5" class="empty">Nenhum apartamento hospedado neste dia.</td></tr>`;
      else rows += `<tr class="foot"><td colspan="2">Com café: ${pl(o.aptosCafe, "apto")}${o.semCafe ? ` · sem café: ${o.semCafe}` : ""}</td><td class="num">${o.adultos}</td><td class="num">${o.criancas}</td><td></td></tr>`;
      l += `<div class="card"><h3 class="row" style="justify-content:space-between;align-items:center"><span class="tag e${k}">${EMP[k]}</span>
        ${o.aptos.length || o.exA + o.exC ? `<button class="btn danger small noprint" data-excluir="${k}" title="Tira este dia da relação do ${EMP[k]}">🗑 Excluir relação do dia</button>` : ""}</h3>
        <table><thead><tr><th>Apto</th><th>Hóspede</th><th class="num">Ad.</th><th class="num">Cr.</th><th>Saída</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="extras"><span>Extras do dia (day use, café avulso pago, convidados…)</span>
          <label>Adultos<input type="number" min="0" data-ex="${k}" data-t="a" value="${o.exA || ""}" placeholder="0"></label>
          <label>Crianças<input type="number" min="0" data-ex="${k}" data-t="c" value="${o.exC || ""}" placeholder="0"></label>
        </div>
        ${o.exA + o.exC ? `<p class="printonly hint">Extras: ${pessoas(o.exA, o.exC)}</p>` : ""}
      </div>`;
    }
    $("listas").innerHTML = l;
  }

  const p = pedido(res);
  $("pedido").innerHTML = res.T && p.length
    ? p.map(i => `<tr><td>${esc(i.nome)}</td><td class="num"><b>${esc(fmtQ(i.q, i.un))}</b></td></tr>`).join("")
    : `<tr><td colspan="2" class="empty">Sem pessoas previstas para este dia.</td></tr>`;
  $("pedidoHint").textContent = `Calculado para ${pl(res.T, "pessoa")}, com ${+db.margem || 0}% de margem. Ajuste as quantidades por pessoa em "Pedido padaria & backup".`;
  $("printFoot").textContent = "Gerado em " + new Date().toLocaleString("pt-BR");
}

function textoWhatsApp() {
  const res = resumo(diaSel);
  let t = `☕ *Café da manhã – ${dataLonga(diaSel)}*\n\n`;
  for (const k in EMP) {
    const o = res.emp[k];
    t += `*${EMP[k]}:* ${pl(o.tot, "pessoa")} (${pessoas(o.totA, o.totC)}) – ${pl(o.aptosCafe, "apto")}${o.semCafe ? ` (+${o.semCafe} sem café)` : ""}\n`;
  }
  t += `\n*TOTAL: ${pl(res.T, "pessoa")}* (${pessoas(res.A, res.C)})\n`;
  const p = pedido(res);
  if (res.T && p.length) t += `\n🥐 *Pedido padaria:*\n` + p.map(i => `• ${i.nome}: ${fmtQ(i.q, i.un)}`).join("\n") + "\n";
  return t;
}

// ---------- relatório impresso padronizado ----------
let usuarioEmail = "";
function renderRelatorio() {
  const dia = diaSel, res = resumo(dia);
  const semana = toDate(dia).toLocaleDateString("pt-BR", { weekday: "long" });
  const soma = f => Object.keys(EMP).reduce((s, k) => s + f(res.emp[k]), 0);

  let h = `<div class="r-head">
    <div><div class="r-tit">RELAÇÃO DO CAFÉ DA MANHÃ</div><div class="r-sub">9006 Suites · Reserva Madero</div></div>
    <div class="r-data">${semana}<b>${br(dia)}</b></div></div>`;

  // quadro-resumo
  h += `<table><thead><tr><th>Empreendimento</th><th class="num">Aptos com café</th><th class="num">Aptos sem café</th>
    <th class="num">Adultos</th><th class="num">Crianças</th><th class="num">Extras</th><th class="num">Total no café</th></tr></thead><tbody>`;
  for (const k in EMP) {
    const o = res.emp[k];
    h += `<tr><td>${EMP[k]}</td><td class="num">${o.aptosCafe}</td><td class="num">${o.semCafe}</td><td class="num">${o.adultos}</td>
      <td class="num">${o.criancas}</td><td class="num">${o.exA + o.exC}</td><td class="num"><b>${o.tot}</b></td></tr>`;
  }
  h += `<tr class="total"><td>TOTAL</td><td class="num">${soma(o => o.aptosCafe)}</td><td class="num">${soma(o => o.semCafe)}</td>
    <td class="num">${soma(o => o.adultos)}</td><td class="num">${soma(o => o.criancas)}</td><td class="num">${soma(o => o.exA + o.exC)}</td>
    <td class="num">${res.T}</td></tr></tbody></table>`;

  // lista por empreendimento
  for (const k in EMP) {
    const o = res.emp[k];
    h += `<h3>${EMP[k]} — ${pl(o.tot, "pessoa")} no café</h3>`;
    if (!o.aptos.length) { h += `<p class="r-obs">Nenhum apartamento hospedado.</p>`; }
    else {
      h += `<table><thead><tr><th style="width:7%">Apto</th><th style="width:8%">Reserva</th><th style="width:20%">Hóspede</th><th style="width:22%">Acompanhante(s)</th>
        <th class="num" style="width:5%">Ad.</th><th class="num" style="width:5%">Cr.</th><th class="num" style="width:11%">Café</th>
        <th>Observação</th><th class="num chk">✓</th></tr></thead><tbody>`;
      for (const r of o.aptos) {
        const pessoasApto = (+r.adultos || 0) + (+r.criancas || 0);
        const nomes = listaAcomp(r.acompanhante), semNome = Math.max(0, pessoasApto - 1 - nomes.length);
        const acomp = [...nomes.map(esc), semNome ? `<span class="falta">${semNome > 1 ? `${semNome} sem nome` : "não informado"}</span>` : ""]
          .filter(Boolean).join("<br>") || "—";
        const obs = [r.checkout === dia && !saidaIncerta(r) ? "Check-out hoje" : "", esc(r.obs)].filter(Boolean).join(" · ");
        h += `<tr class="${r.cafe ? "" : "sem"}"><td><b>${esc(r.apto)}</b></td><td>${esc(r.reserva) || "—"}</td><td>${esc(r.hospede) || "—"}</td><td>${acomp}</td>
          <td class="num">${num(r.adultos)}</td><td class="num">${num(r.criancas)}</td>
          <td class="num ${r.cafe ? "cafe-sim" : "cafe-nao"}">${r.cafe ? "COM CAFÉ" : "SEM CAFÉ"}</td>
          <td>${obs}</td><td></td></tr>`;
      }
      h += `</tbody></table>`;
    }
    if (o.exA + o.exC) h += `<p class="r-obs"><b>Extras do dia</b> (day use, café avulso, convidados): ${pessoas(o.exA, o.exC)}</p>`;
  }

  // pedido à padaria (opcional)
  if ($("chkPedidoPrint").checked) {
    const p = pedido(res);
    h += `<h3>Pedido à padaria — ${pl(res.T, "pessoa")}</h3>`;
    h += res.T && p.length
      ? `<table><thead><tr><th>Item</th><th class="num" style="width:25%">Quantidade</th></tr></thead><tbody>` +
        p.map(i => `<tr><td>${esc(i.nome)}</td><td class="num">${esc(fmtQ(i.q, i.un))}</td></tr>`).join("") +
        `</tbody></table><p class="r-obs">Quantidades com ${+db.margem || 0}% de margem de segurança.</p>`
      : `<p class="r-obs">Sem pessoas previstas.</p>`;
  }

  h += `<div class="r-assin"><div>Recepção (nome / assinatura)</div><div>Restaurante (nome / assinatura)</div></div>
    <div class="r-rodape">Gerado em ${new Date().toLocaleString("pt-BR")}${usuarioEmail ? " por " + esc(usuarioEmail) : ""}.
    O café conta da manhã seguinte ao check-in até a manhã do check-out. Hóspedes "SEM CAFÉ" aparecem só para conferência e não entram no total.</div>`;
  $("relatorio").innerHTML = h;
}
function imprimirRelacao() { renderRelatorio(); window.print(); }
window.addEventListener("beforeprint", renderRelatorio); // também funciona com Ctrl+P

// =====================================================================
//  IMPORTAÇÃO DO PDF "CONTROLE DE PENSÃO" (lido no navegador com pdf.js)
// =====================================================================
// pdf.js: cópia local com versão fixa (ver vendor/LEIAME.txt)
const PDFJS_LIB = new URL("vendor/pdf-4.10.38.min.mjs", location.href).href;
const PDFJS_WORKER = new URL("vendor/pdf.worker-4.10.38.min.mjs", location.href).href;
let pdfjsPromise = null;
function carregarPdfJs() {
  if (!pdfjsPromise) pdfjsPromise = import(PDFJS_LIB).then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; })
    .catch(e => { pdfjsPromise = null; throw e; });
  return pdfjsPromise;
}
const semAcento = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

// Junta os pedaços de texto de uma célula, pondo espaço quando há distância entre eles
function juntar(itens) {
  let s = "", fim = null;
  for (const it of itens) {
    if (fim !== null && it.x - fim > 1 && !s.endsWith(" ") && !it.s.startsWith(" ")) s += " ";
    s += it.s; fim = it.x + it.w;
  }
  return s.replace(/\s+/g, " ").trim();
}
// Abre o PDF com segurança
async function abrirPdf(file) {
  const pdfjs = await carregarPdfJs();
  if (file.size > 20 * 1024 * 1024) throw new Error("arquivo muito grande (máximo 20 MB)");
  // isEvalSupported:false = pdf.js não executa código gerado a partir do PDF (proteção contra PDF malicioso)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false }).promise;
  if (doc.numPages > 50) throw new Error("PDF com páginas demais (máximo 50)");
  return { pdfjs, doc };
}
// Lê o texto letra por letra (com a posição de cada uma). Usado na "Listagem para Café/Pensão",
// cuja fonte tem espaçamento irregular entre letras: assim os espaços vêm só dos espaços de verdade.
async function itensPorGlifos(page, pdfjs) {
  const OPS = pdfjs.OPS, ops = await page.getOperatorList();
  const mul = (m, n) => [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];
  let ctm = [1,0,0,1,0,0], tm = [1,0,0,1,0,0], tlm = [1,0,0,1,0,0], tam = 12, cs = 0, ws = 0, hs = 1;
  const pilha = [], glifos = [];
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k], a = ops.argsArray[k];
    if (fn === OPS.save) pilha.push(ctm.slice());
    else if (fn === OPS.restore) ctm = pilha.pop() || [1,0,0,1,0,0];
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.beginText) { tm = [1,0,0,1,0,0]; tlm = tm.slice(); }
    else if (fn === OPS.setFont) tam = a[1];
    else if (fn === OPS.setCharSpacing) cs = a[0];
    else if (fn === OPS.setWordSpacing) ws = a[0];
    else if (fn === OPS.setHScale) hs = a[0] / 100;
    else if (fn === OPS.setTextMatrix) { tm = a.slice(0, 6); tlm = tm.slice(); }
    else if (fn === OPS.moveText) { tlm = mul(tlm, [1,0,0,1,a[0],a[1]]); tm = tlm.slice(); }
    else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      for (const g of a[0]) {
        if (typeof g === "number") { tm = mul(tm, [1,0,0,1,-g/1000*tam*hs,0]); continue; }
        const m = mul(ctm, tm), adv = ((g.width || 0) * tam / 1000 + cs + (g.unicode === " " ? ws : 0)) * hs;
        glifos.push({ x: m[4], y: m[5], w: adv * Math.hypot(m[0], m[1]), s: g.unicode || "", fs: tam * Math.hypot(m[2], m[3]) });
        tm = mul(tm, [1,0,0,1,adv,0]);
      }
    }
  }
  // junta as letras em pedaços de texto (células): quebra quando muda a linha ou há um salto grande
  const itens = []; let cur = null;
  for (const g of glifos) {
    const fs = g.fs || 8;
    if (cur && Math.abs(g.y - cur.y) < fs * 0.3 && g.x >= cur.fim - fs * 0.3 && g.x - cur.fim < fs * 1.0) {
      if (g.x - cur.fim > fs * 0.32 && !cur.s.endsWith(" ") && g.s !== " ") cur.s += " ";
      cur.s += g.s; cur.fim = g.x + g.w;
    } else { if (cur) itens.push(cur); cur = { x: g.x, y: g.y, s: g.s, fim: g.x + g.w }; }
  }
  if (cur) itens.push(cur);
  return itens.map(i => ({ x: i.x, y: i.y, w: i.fim - i.x, s: i.s.replace(/\s+/g, " ").trim() })).filter(i => i.s);
}
// "LISTAGEM PARA CAFÉ/PENSÃO": uma linha por hóspede; o número do apto aparece uma vez por quarto
// (célula mesclada), e "QTDE PAX" diz quantas linhas pertencem àquele apto
async function interpretarListagem(doc, pdfjs) {
  let emp = null, dataTitulo = null, totalPdf = null;
  const linhas = [], uhs = [];
  const D = /^\d{2}\/\d{2}\/\d{4}$/;
  for (let p = 1; p <= doc.numPages; p++) {
    const itens = await itensPorGlifos(await doc.getPage(p), pdfjs);
    for (const it of itens) {
      const T = semAcento(it.s); let m;
      if (!emp && /^9006\b/.test(T)) emp = "9006";
      if (!emp && T.includes("MADERO")) emp = "madero";
      if (!dataTitulo && (m = T.match(/FILTRADO DE (\d{2}\/\d{2}\/\d{4})/))) dataTitulo = parseData(m[1]);
      if (totalPdf === null && T.includes("TOTAL DO DIA")) {
        const n = itens.filter(i => /^\d+$/.test(i.s) && i.y < it.y && it.y - i.y < 30 && Math.abs(i.x - it.x) < 90).sort((a, b) => b.y - a.y)[0];
        if (n) totalPdf = +n.s;
      }
    }
    const ancoras = itens.filter(i => /^(TITULAR|ACOMPANHANTE)$/.test(semAcento(i.s)));
    if (!ancoras.length) continue;
    const xTipoFim = Math.max(...ancoras.map(a => a.x + a.w));
    const datas = itens.filter(i => D.test(i.s) && i.x > xTipoFim);
    const xData = datas.length ? Math.min(...datas.map(d => d.x)) : Infinity;
    const codigos = [];
    for (const a of ancoras) {
      const naLinha = itens.filter(i => Math.abs(i.y - a.y) < 3);
      const cod = naLinha.filter(i => i.x < a.x && /^\d+$/.test(i.s)).sort((x, y) => y.x - x.x)[0];
      if (cod) codigos.push(cod.x);
      const dts = naLinha.filter(i => D.test(i.s)).sort((x, y) => x.x - y.x);
      linhas.push({
        p, y: a.y, titular: semAcento(a.s) === "TITULAR", reserva: cod ? cod.s : "", nomes: [],
        faixa: (naLinha.find(i => i.x > xData && /^(ADULT|CRIAN|BEBE|INFANT|CHD)/.test(semAcento(i.s))) || {}).s || "ADULTO",
        cafe: semAcento((naLinha.find(i => i.x > xData && /^(SIM|NAO)$/.test(semAcento(i.s))) || { s: "SIM" }).s) === "SIM",
        ini: dts[0] ? parseData(dts[0].s) : null, fim: dts[1] ? parseData(dts[1].s) : null
      });
    }
    // nome: tudo entre a coluna "tipo hóspede" e a de datas; nomes longos quebram em 2 linhas,
    // então cada pedaço vai para a linha de hóspede mais próxima na altura
    const linhasPag = linhas.filter(l => l.p === p);
    for (const it of itens) {
      if (it.x <= xTipoFim - 1 || it.x >= xData - 2 || ancoras.includes(it)) continue;
      const alvo = linhasPag.map(l => [l, Math.abs(l.y - it.y)]).sort((a, b) => a[1] - b[1])[0];
      if (alvo && alvo[1] < 14) alvo[0].nomes.push(it);
    }
    // número do apto (coluna mais à esquerda) e QTDE PAX (número ao lado)
    const xCod = codigos.length ? Math.min(...codigos) : 0;
    const esquerda = itens.filter(i => /^\d+$/.test(i.s) && i.x < xCod - 5);
    if (esquerda.length) {
      const xUH = Math.min(...esquerda.map(i => i.x));
      for (const u of esquerda.filter(i => i.x < xUH + 15)) {
        const pax = esquerda.find(i => i.x >= xUH + 15 && Math.abs(i.y - u.y) < 3);
        uhs.push({ p, y: u.y, uh: u.s, pax: pax ? +pax.s : 0 });
      }
    }
  }
  // liga cada hóspede ao seu apto: em ordem, cada apto "consome" QTDE PAX linhas
  const ordem = (a, b) => a.p - b.p || b.y - a.y;
  linhas.sort(ordem); uhs.sort(ordem);
  let idx = 0, sequencialOk = uhs.length > 0;
  for (const u of uhs) {
    const grupo = linhas.slice(idx, idx + Math.max(1, u.pax));
    const mesmaPag = grupo.filter(l => l.p === u.p);
    if (!grupo.length || (mesmaPag.length && (u.y > Math.max(...mesmaPag.map(l => l.y)) + 9 || u.y < Math.min(...mesmaPag.map(l => l.y)) - 9))) { sequencialOk = false; break; }
    grupo.forEach(l => l.apto = u.uh);
    idx += grupo.length;
  }
  if (!sequencialOk || idx !== linhas.length)   // plano B: apto mais próximo na mesma página
    for (const l of linhas) {
      const u = uhs.filter(u => u.p === l.p).sort((a, b) => Math.abs(a.y - l.y) - Math.abs(b.y - l.y))[0];
      l.apto = u ? u.uh : (l.apto || "?");
    }
  const pessoas = linhas.map(l => ({
    nome: l.nomes.sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(" ").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR"),
    faixa: l.faixa, apto: l.apto, tipo: "", reserva: l.reserva, cafe: l.cafe, titular: l.titular
  }));
  return { pessoas, dataTitulo, diaria: null, totalPdf, emp };
}
// "CONTROLE DE PENSÃO" (relatório antigo): devolve as linhas (itens de texto agrupados pela altura)
async function linhasDoDoc(doc) {
  const linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const itens = tc.items.filter(it => it.str && it.str.trim())
      .map(it => ({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const pls = [];
    for (const it of itens) {
      let l = pls.find(l => Math.abs(l.y - it.y) <= 3);
      if (!l) { l = { y: it.y, itens: [] }; pls.push(l); }
      l.itens.push(it);
    }
    pls.sort((a, b) => b.y - a.y).forEach(l => { l.itens.sort((a, b) => a.x - b.x); linhas.push(l); });
  }
  return linhas;
}
const COLS = { HOSPEDE: "hospede", FAIXA: "faixa", PENSAO: "pensao", UH: "uh", RESERVA: "reserva", CAFE: "cafe", ALMOCO: "almoco", JANTAR: "jantar" };
function celulas(l, cols) {
  const ord = Object.entries(cols).sort((a, b) => a[1] - b[1]);
  const g = {};
  for (const it of l.itens) {
    let col = null;
    for (const [nome, x] of ord) if (x <= it.x + 10) col = nome;
    if (col) (g[col] ||= []).push(it);
  }
  const out = {};
  for (const k in g) out[k] = juntar(g[k]);
  return out;
}
function interpretarPdf(linhas) {
  let cols = null, dataTitulo = null, diaria = null, totalPdf = null, proximaTemTotal = false;
  const pessoas = [];
  for (const l of linhas) {
    const t = juntar(l.itens), T = semAcento(t);
    let m;
    // quadro do topo: "CAFÉ DA MANHÃ  ALMOÇO  JANTAR" e, na linha de baixo, "26  00  00"
    if (proximaTemTotal) { proximaTemTotal = false; if (totalPdf === null && (m = t.match(/(\d+)/))) { totalPdf = +m[1]; continue; } } // (a linha começa com o ícone da xícara)
    if (!cols && T.startsWith("CAFE DA MANHA") && T.includes("ALMOCO")) { proximaTemTotal = true; continue; }
    if (!dataTitulo && (m = T.match(/CONTROLE DE PENSAO\s*-\s*(\d{2}\/\d{2}\/\d{4})/))) { dataTitulo = parseData(m[1]); continue; }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) { diaria = parseData(t); continue; }
    if (T.includes("HOSPEDE") && T.includes("RESERVA") && T.includes("CAFE")) {
      cols = {};
      for (const it of l.itens) { const k = COLS[semAcento(it.s).split(" ")[0]]; if (k && cols[k] === undefined) cols[k] = it.x; }
      continue;
    }
    if (!cols) continue;
    const c = celulas(l, cols);
    if (T.startsWith("REFEICOES DO DIA")) { if (totalPdf === null && /^\d+$/.test(c.cafe || "")) totalPdf = +c.cafe; continue; }
    const cafe = semAcento(c.cafe);
    if (!c.hospede || !/^\d+$/.test(c.reserva || "") || !/^(SIM|NAO)$/.test(cafe)) continue;
    const uh = (c.uh || "").match(/^(\S+)\s*-\s*(.*)$/);
    pessoas.push({ nome: c.hospede, faixa: c.faixa || "", apto: uh ? uh[1] : (c.uh || ""), tipo: uh ? uh[2] : "", reserva: c.reserva, cafe: cafe === "SIM" });
  }
  return { pessoas, dataTitulo, diaria, totalPdf };
}
// Agrupa os hóspedes por apto + reserva: o primeiro com nome é o titular, os demais são acompanhantes
function agruparPorApto(pessoas) {
  const ehGenerico = n => /^ACOMPANHANTE\b/.test(semAcento(n));
  const ehCrianca = p => !/^ADULT/.test(semAcento(p.faixa || "ADULTO"));
  const grupos = new Map();
  for (const p of pessoas) {
    const k = p.apto + "|" + p.reserva;
    if (!grupos.has(k)) grupos.set(k, { apto: p.apto, tipo: p.tipo, reserva: p.reserva, pessoas: [] });
    grupos.get(k).pessoas.push(p);
  }
  return [...grupos.values()].map(g => {
    const comCafe = g.pessoas.filter(p => p.cafe), semCafe = g.pessoas.filter(p => !p.cafe);
    const cafe = comCafe.length > 0;
    const conta = cafe ? comCafe : g.pessoas;            // apto misto: só conta quem tem café
    // titular: quem o PDF marca como "Titular" (se houver); senão, o primeiro com nome
    const titular = g.pessoas.find(p => p.titular && !ehGenerico(p.nome)) || g.pessoas.find(p => !ehGenerico(p.nome)) || g.pessoas[0];
    const outros = g.pessoas.filter(p => p !== titular);
    // nome repetido (ex.: o titular aparece 2x) conta como pessoa sem nome
    const vistos = new Set([semAcento(titular.nome)]), nomesAcomp = []; let semNome = 0;
    for (const p of outros) {
      const k = semAcento(p.nome);
      if (!p.nome || ehGenerico(p.nome) || vistos.has(k)) semNome++; else { vistos.add(k); nomesAcomp.push(p.nome); }
    }
    const obs = cafe && semCafe.length ? `Sem café: ${semCafe.map(p => ehGenerico(p.nome) ? "acompanhante" : p.nome).join(", ")}` : "";
    return {
      apto: g.apto, tipo: g.tipo, reserva: g.reserva,
      hospede: ehGenerico(titular.nome) ? "" : titular.nome,
      acompanhante: juntarAcomp(nomesAcomp),
      semNome,
      adultos: conta.filter(p => !ehCrianca(p)).length, criancas: conta.filter(ehCrianca).length, cafe, obs
    };
  }).sort((a, b) => String(a.apto).localeCompare(String(b.apto), "pt-BR", { numeric: true }));
}

let imp = null; // importação em conferência
async function processarPdf(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { toast("Escolha um arquivo PDF."); return; }
  imp = null; $("pdfRevisao").innerHTML = '<p class="hint">Lendo o PDF…</p>';
  try {
    const { pdfjs, doc } = await abrirPdf(file);
    // descobre o formato pela 1ª página: "Listagem para Café/Pensão" (novo) ou "Controle de Pensão" (antigo)
    const tc1 = await (await doc.getPage(1)).getTextContent();
    const ehListagem = semAcento(tc1.items.map(i => i.str).join("")).replace(/\s/g, "").includes("LISTAGEMPARACAFE");
    const r = ehListagem ? await interpretarListagem(doc, pdfjs) : interpretarPdf(await linhasDoDoc(doc));
    if (!r.pessoas.length) {
      $("pdfRevisao").innerHTML = '<div class="alerta">Não encontrei hóspedes neste PDF. Use a <b>Listagem para Café/Pensão</b> (ou o Controle de Pensão) do sistema do hotel.</div>';
      return;
    }
    if (r.emp && EMP[r.emp]) $("pdfEmp").value = r.emp;   // o PDF diz de qual empreendimento é
    imp = {
      arquivo: file.name, formato: ehListagem ? "Listagem para Café/Pensão" : "Controle de Pensão", empDetectado: r.emp || null,
      data: r.dataTitulo || (r.diaria ? addDays(r.diaria, 1) : addDays(hoje(), 1)),
      totalPdf: r.totalPdf, simLidos: r.pessoas.filter(p => p.cafe).length, hospedesLidos: r.pessoas.length,
      itens: agruparPorApto(r.pessoas).map(i => ({ ...i, pdf: { ...i } })) // guarda o que veio do PDF
    };
    prepararImportacao();
    renderRevisao();
  } catch (e) {
    console.error(e);
    $("pdfRevisao").innerHTML = `<div class="alerta">Não consegui ler o PDF: ${esc(e.message || e)}. Verifique a internet e tente de novo.</div>`;
  }
}
// Procura a mesma estadia já cadastrada: mesmo empreendimento + nº da reserva + apto
function acharEstadia(emp, reserva, apto) {
  reserva = String(reserva || "").trim(); apto = String(apto || "").trim();
  if (!reserva) return null;
  return db.reservas.filter(r => r.emp === emp && String(r.reserva || "").trim() === reserva && String(r.apto).trim() === apto)
    .sort((a, b) => b.checkout.localeCompare(a.checkout))[0] || null;
}
// Junta o PDF com o que já existe. Regras:
//  - titular e adultos/crianças: valem os do PDF (ocupação atual)
//  - acompanhante e observação: valem os que vocês já digitaram
//  - café: se já estava COM café, continua COM café mesmo que o PDF diga NÃO
//  - saída: se já foi confirmada (ex.: dia 29), é mantida; senão vira o dia deste PDF
function prepararImportacao() {
  const emp = $("pdfEmp").value, data = imp.data, ontem = addDays(data, -1);
  for (const i of imp.itens) {
    const p = i.pdf, ex = acharEstadia(emp, p.reserva, p.apto);
    Object.assign(i, { apto: p.apto, reserva: p.reserva, hospede: p.hospede, acompanhante: p.acompanhante, adultos: p.adultos, criancas: p.criancas, cafe: p.cafe, obs: p.obs });
    i.exId = ex ? ex.id : null; i.cafeMantido = false;
    // "conferida" continua valendo no dia seguinte, a não ser que o PDF traga algo diferente
    const mudou = !!ex && (num(ex.adultos) !== num(p.adultos) || num(ex.criancas) !== num(p.criancas) || (p.cafe && !ex.cafe));
    i.conferida = !!(ex && ex.conferida && !mudou);
    i.mudou = !!(ex && ex.conferida && mudou);
    i.confEm = i.conferida ? ex.conferida_em : null; i.confPor = i.conferida ? ex.conferida_por : "";
    if (ex) {
      i.hospede = p.hospede || ex.hospede;
      i.acompanhante = ex.acompanhante || p.acompanhante;
      if (!p.cafe && ex.cafe) { i.cafe = true; i.cafeMantido = true; }
      const obsEx = String(ex.obs || "").split(" · ").filter(o => o && !o.startsWith("Sem café:"));
      i.obs = [...obsEx, p.obs].filter(Boolean).join(" · ");
      i.checkin = ex.checkin < ontem ? ex.checkin : ontem;
      i.saida = ex.checkout > data ? ex.checkout : data;
      i.saidaDefinida = !saidaIncerta(ex) && ex.checkout >= data;
    } else {
      i.checkin = ontem; i.saida = data; i.saidaDefinida = false;
    }
  }
  // quem o sistema esperava para este dia e não veio no PDF (saiu antes / não está mais no hotel)
  const achados = new Set(imp.itens.map(i => i.exId).filter(Boolean));
  imp.ausentes = db.reservas
    .filter(r => r.emp === emp && hospedado(r, data) && !achados.has(r.id) && (doPdf(r) || String(r.reserva || "").trim()))
    .map(r => ({ id: r.id, apto: r.apto, reserva: r.reserva, hospede: r.hospede, checkout: r.checkout, encerrar: true }));
}
function renderRevisao() {
  const el = $("pdfRevisao");
  if (!imp) { el.innerHTML = ""; return; }
  const existentes = imp.itens.filter(i => i.exId).length, mantidos = imp.itens.filter(i => i.cafeMantido).length;
  const conferidas = imp.itens.filter(i => i.conferida).length, mudaram = imp.itens.filter(i => i.mudou).length;
  const pessoasCafe = imp.itens.filter(i => i.cafe).reduce((s, i) => s + (+i.adultos || 0) + (+i.criancas || 0), 0);
  const semNomeTotal = imp.itens.reduce((s, i) => { const nomes = listaAcomp(i.acompanhante); return s + Math.max(0, qtdAcomp(i.adultos, i.criancas, nomes) - nomes.length); }, 0);
  let aviso = "";
  if (imp.totalPdf !== null) aviso = imp.totalPdf === imp.simLidos
    ? `<span class="okb">✓ O PDF diz ${imp.totalPdf} cafés e foram lidos ${imp.simLidos}.</span>`
    : `<div class="alerta">Atenção: o PDF diz <b>${imp.totalPdf}</b> cafés, mas foram lidos <b>${imp.simLidos}</b>. Confira a lista antes de salvar.</div>`;
  el.innerHTML = `
    <div class="row rev-head">
      <label>Data do café<input type="date" id="impData" value="${imp.data}"></label>
      <div class="hint" style="margin:0;flex:1"><b>${esc(imp.arquivo)}</b> · ${esc(imp.formato || "")}${imp.empDetectado ? ` · <b>${esc(EMP[imp.empDetectado] || "")}</b> (detectado no PDF)` : ""}<br>${imp.hospedesLidos} hóspedes lidos → ${pl(imp.itens.length, "apto")} ·
        <b>${pl(pessoasCafe, "pessoa")} com café</b>${semNomeTotal ? ` · <b>${semNomeTotal} acompanhante(s) sem nome</b> (campos em amarelo)` : ""}
        <br>${imp.itens.length - existentes} nova(s) ·<b>${existentes} já cadastrada(s)</b> (mantém acompanhantes, observações e café)${mantidos ? ` · <b>${mantidos} com café mantido</b>` : ""}</div>
      ${aviso}
    </div>
    <div class="row" style="align-items:center;margin-bottom:8px">
      <span><span class="okmark">✓</span><b>${conferidas}</b> de ${imp.itens.length} conferido(s)${mudaram ? ` · <span class="tag mudou">${mudaram} mudou(aram) no PDF — conferir de novo</span>` : ""}</span>
      <button class="btn-conf" id="btnImpConfTodos" type="button">✓ Marcar todos como conferidos</button>
    </div>
    <div style="overflow-x:auto"><table class="rev">
      <thead><tr><th style="width:104px">Conferida</th><th style="width:72px">Apto</th><th style="width:76px">Reserva</th><th style="min-width:230px">Titular</th><th style="min-width:230px">Acompanhante(s)</th><th style="width:60px">Ad.</th><th style="width:60px">Cr.</th><th style="width:120px">Café</th><th>Obs.</th><th></th></tr></thead>
      <tbody>${imp.itens.map((i, n) => `<tr class="${i.conferida ? "conf" : i.cafe ? "" : "sem"}">
        <td><label class="conf-chk"><input type="checkbox" data-i="${n}" data-f="conferida"${i.conferida ? " checked" : ""}> ${i.conferida ? "Conferida" : "Conferir"}</label>
          ${i.mudou ? '<span class="tag mudou" title="Estava conferida, mas o PDF trouxe outra quantidade de pessoas ou café">mudou</span>' : ""}</td>
        <td><input data-i="${n}" data-f="apto" value="${esc(i.apto)}"><small>${i.exId ? "↻ já cadastrada" : "nova"}</small></td>
        <td><input data-i="${n}" data-f="reserva" value="${esc(i.reserva)}"></td>
        <td><input data-i="${n}" data-f="hospede" value="${esc(i.hospede)}"></td>
        <td>${(() => {
          const nomes = listaAcomp(i.acompanhante), qtd = qtdAcomp(i.adultos, i.criancas, nomes);
          return qtd ? Array.from({ length: qtd }, (_, j) => `<input data-i="${n}" data-f="acomp" data-k="${j}" value="${esc(nomes[j] || "")}"
            placeholder="Acompanhante ${j + 1}${!nomes[j] && i.semNome ? " (sem nome no PDF)" : ""}" class="${nomes[j] ? "" : "falta"}">`).join("")
            : '<small>só o titular</small>';
        })()}</td>
        <td><input type="number" min="0" data-i="${n}" data-f="adultos" value="${num(i.adultos)}"></td>
        <td><input type="number" min="0" data-i="${n}" data-f="criancas" value="${num(i.criancas)}"></td>
        <td><select data-i="${n}" data-f="cafe"><option value="1"${i.cafe ? " selected" : ""}>COM café</option><option value="0"${i.cafe ? "" : " selected"}>SEM café</option></select>
          ${i.cafeMantido ? '<small>mantido (o PDF diz NÃO)</small>' : ""}</td>
        <td><input data-i="${n}" data-f="obs" value="${esc(i.obs)}"></td>
        <td><button class="btn danger small" data-rm="${n}" title="Tirar da importação">✕</button></td></tr>`).join("")}
      </tbody></table></div>
    ${imp.ausentes.length ? `<div class="alerta" style="margin-top:12px"><b>${pl(imp.ausentes.length, "apto")} estava(m) previsto(s) para ${br(imp.data)} e não aparece(m) neste PDF.</b>
      Marcados = a estadia termina no dia anterior (o hóspede já saiu). Desmarque se for engano.
      <div style="margin-top:6px">${imp.ausentes.map((a, n) => `<label class="chk" style="padding:2px 0"><input type="checkbox" data-aus="${n}"${a.encerrar ? " checked" : ""}>
        Apto <b>${esc(a.apto)}</b>${a.reserva ? ` · Res. ${esc(a.reserva)}` : ""} · ${esc(a.hospede) || "—"} (previsto até ${br(a.checkout)})</label>`).join("")}</div></div>` : ""}
    <div class="row" style="margin-top:10px">
      <button class="btn" id="btnImpSalvar">Salvar ${pl(imp.itens.length, "apto")} no sistema</button>
      <button class="btn sec" id="btnImpCancelar">Cancelar</button>
    </div>`;
}
async function salvarImportacao() {
  const emp = $("pdfEmp").value, data = imp.data;
  if (!data) { toast("Informe a data do café."); return; }
  const usados = new Set();
  const lista = imp.itens.filter(i => String(i.apto).trim()).map(i => {
    const apto = String(i.apto).trim(), reserva = String(i.reserva || "").trim();
    // se o apto/reserva foi corrigido na conferência, procura de novo a estadia certa
    const ex = (i.exId && apto === i.pdf.apto && reserva === i.pdf.reserva) ? db.reservas.find(r => r.id === i.exId) : acharEstadia(emp, reserva, apto);
    let id = ex && !usados.has(ex.id) ? ex.id : `pdf-${emp}-${reserva || "x"}-${apto}-${data}`;
    while (usados.has(id)) id += "b";
    usados.add(id);
    const saida = i.saida && i.saida >= data ? i.saida : data;
    return {
      id, emp, apto, reserva, hospede: String(i.hospede).trim(), acompanhante: String(i.acompanhante).trim(),
      adultos: Math.max(0, parseInt(i.adultos) || 0), criancas: Math.max(0, parseInt(i.criancas) || 0),
      checkin: ex && ex.checkin < i.checkin ? ex.checkin : i.checkin, checkout: saida,
      cafe: !!i.cafe, obs: String(i.obs).trim(), saida_definida: !!i.saidaDefinida,
      conferida: !!i.conferida, conferida_em: i.conferida ? (i.confEm || new Date().toISOString()) : null,
      conferida_por: i.conferida ? (i.confPor || usuarioEmail || "este computador") : ""
    };
  });
  // encerra as estadias que não vieram no PDF (marcadas na conferência)
  const encerradas = [], apagar = [];
  for (const a of imp.ausentes.filter(a => a.encerrar)) {
    const r = db.reservas.find(x => x.id === a.id); if (!r) continue;
    const fim = addDays(data, -1);
    if (fim <= r.checkin) apagar.push(r.id); else encerradas.push({ ...r, checkout: fim, saida_definida: true });
  }
  const gravar_ = lista.concat(encerradas), ids = new Set(gravar_.map(r => r.id).concat(apagar));
  db.reservas = db.reservas.filter(r => !ids.has(r.id)).concat(gravar_);
  localStorage.setItem("cafe-pdf-emp", emp);
  imp = null; renderRevisao();
  diaSel = data; renderTudo();
  if (await Store.aplicarImportacao(gravar_, apagar)) {
    toast(`${pl(lista.length, "apto")} salvo(s) para o café de ${br(data)}${encerradas.length + apagar.length ? ` · ${encerradas.length + apagar.length} estadia(s) encerrada(s)` : ""}.`, 4000);
    document.querySelector('nav button[data-tab="relacao"]').click();
  }
}

// ---------- render: reservas ----------
function botaoConf(r) {
  const quem = r.conferida && (r.conferida_por || r.conferida_em)
    ? `Conferida${r.conferida_por ? " por " + r.conferida_por : ""}${r.conferida_em ? " em " + new Date(r.conferida_em).toLocaleString("pt-BR") : ""}. Clique para desmarcar.`
    : "Clique para marcar como conferida";
  return `<button class="btn-conf${r.conferida ? " ok" : ""}" data-conf="${esc(r.id)}" title="${esc(quem)}">${r.conferida ? "✓ Conferida" : "Conferir"}</button>`;
}
function renderReservas() {
  const q = $("busca").value.trim().toLowerCase(), fe = $("filtroEmp").value, per = $("filtroPer").value, h = hoje();
  const ativas = db.reservas.filter(r => r.checkout >= h && (!fe || r.emp === fe));
  const nConf = ativas.filter(r => r.conferida).length;
  $("contConf").innerHTML = ativas.length ? `<span class="okmark">✓</span><b>${nConf}</b> de ${ativas.length} reservas hospedadas/futuras conferidas${ativas.length - nConf ? ` · <b>${ativas.length - nConf}</b> pendente(s)` : " — tudo conferido!"}` : "";
  const lista = db.reservas
    .filter(r => (!fe || r.emp === fe) &&
      (per === "todas" || (r.checkout >= h && (per === "ativas" || (per === "pendentes" ? !r.conferida : !!r.conferida)))) &&
      (!q || String(r.apto).toLowerCase().includes(q) || String(r.reserva || "").toLowerCase().includes(q) ||String(r.hospede || "").toLowerCase().includes(q) || String(r.acompanhante || "").toLowerCase().includes(q)))
    .sort((a, b) => a.checkin.localeCompare(b.checkin) || a.emp.localeCompare(b.emp) || String(a.apto).localeCompare(String(b.apto), "pt-BR", { numeric: true }));
  $("listaRes").innerHTML = lista.length ? lista.map(r => `<tr class="${r.conferida ? "conf" : ""}">
      <td>${botaoConf(r)}</td>
      <td><span class="tag e${esc(r.emp)}">${r.emp === "9006" ? "9006" : "Madero"}</span></td>
      <td><b>${esc(r.apto)}</b></td><td>${esc(r.reserva)}</td><td>${esc(r.hospede)}</td><td>${listaAcomp(r.acompanhante).map(esc).join("<br>")}</td>
      <td class="num">${num(r.adultos)}</td><td class="num">${num(r.criancas)}</td>
      <td>${br(r.checkin)}</td><td>${br(r.checkout)}</td>
      <td>${r.cafe ? "✔" : '<span class="tag no">sem café</span>'}</td>
      <td><small>${esc(r.obs)}</small></td>
      <td style="white-space:nowrap"><button class="btn sec small" data-edit="${esc(r.id)}">Editar</button>
        <button class="btn danger small" data-del="${esc(r.id)}">✕</button></td></tr>`).join("")
    : `<tr><td colspan="13" class="empty">Nenhuma reserva encontrada.</td></tr>`;
}

// ---------- render: config ----------
function renderConfig() {
  const foco = document.activeElement;
  if (foco && (foco.dataset.it !== undefined || foco.id === "margem")) return; // não atrapalha quem está digitando
  $("margem").value = db.margem;
  $("listaItens").innerHTML = db.itens.map((i, n) => `<tr>
    <td><input type="text" data-it="${n}" data-f="nome" value="${esc(i.nome)}"></td>
    <td><input type="text" data-it="${n}" data-f="un" value="${esc(i.un)}" style="width:80px"></td>
    <td class="num"><input type="number" step="any" min="0" data-it="${n}" data-f="adulto" value="${num(i.adulto)}"></td>
    <td class="num"><input type="number" step="any" min="0" data-it="${n}" data-f="crianca" value="${num(i.crianca)}"></td>
    <td><button class="btn danger small" data-delit="${n}">✕</button></td></tr>`).join("");
  $("backupHint").textContent = ONLINE
    ? `Os dados ficam no banco (Supabase) e aparecem em todos os computadores logados. O backup baixa as reservas carregadas (check-out dos últimos ${DIAS_HISTORICO} dias em diante).`
    : "Os dados ficam salvos neste navegador, neste computador. Faça backup de vez em quando, ou para levar para outro computador.";
  const local = ONLINE ? lerLocal() : null;
  $("btnMigrar").hidden = !(local && local.reservas.length);
  if (local) $("btnMigrar").textContent = `Enviar ao banco os dados antigos deste navegador (${pl(local.reservas.length, "reserva")})`;
}

function renderTudo() { renderRelacao(); renderReservas(); renderConfig(); }

// ---------- excluir a relação do dia de um empreendimento ----------
// Tira o dia D de cada estadia daquele empreendimento. Quem continua hospedado em
// outros dias NÃO é apagado: só perde este dia (a estadia é encurtada ou dividida).
let ultimaExclusao = null;
async function excluirRelacao(emp, dia) {
  const afetadas = db.reservas.filter(r => r.emp === emp && hospedado(r, dia));
  const extra = (db.avulsos[dia] || {})[emp];
  if (!afetadas.length && !extra) { toast("Esta relação já está vazia."); return; }
  const ontem = addDays(dia, -1);
  const soEsteDia = afetadas.filter(r => r.checkin === ontem && r.checkout === dia).length;
  const resp = prompt(`Excluir a relação do café de ${br(dia)} do ${EMP[emp]}?\n\n` +
    `• ${pl(afetadas.length, "apto")} sai(em) desta relação` +
    (afetadas.length - soEsteDia ? ` (${afetadas.length - soEsteDia} continua(m) nos outros dias da estadia)` : "") +
    (extra ? `\n• os extras do dia também são apagados` : "") +
    `\n\nVocê poderá desfazer logo em seguida.\nPara confirmar, digite EXCLUIR:`);
  if (resp === null) return;
  if (resp.trim().toUpperCase() !== "EXCLUIR") { toast("Exclusão cancelada: o texto digitado não confere."); return; }

  const originais = afetadas.map(r => ({ ...r })), gravarL = [], apagar = [], criados = [];
  for (const r of afetadas) {
    if (r.checkin === ontem && r.checkout === dia) apagar.push(r.id);                    // estadia era só este dia
    else if (r.checkout === dia) gravarL.push({ ...r, checkout: ontem });                  // tira o último dia
    else if (r.checkin === ontem) gravarL.push({ ...r, checkin: dia });                    // tira o primeiro dia
    else {                                                                                  // meio da estadia: divide
      gravarL.push({ ...r, checkout: ontem, saida_definida: true });
      const novo = { ...r, id: `${r.id}-${dia}`, checkin: dia };
      gravarL.push(novo); criados.push(novo.id);
    }
  }
  const mudou = new Set(gravarL.map(r => r.id).concat(apagar));
  db.reservas = db.reservas.filter(r => !mudou.has(r.id)).concat(gravarL);
  if (db.avulsos[dia]) delete db.avulsos[dia][emp];
  renderTudo();
  if (await Store.excluirRelacao(gravarL, apagar, dia, emp)) {
    ultimaExclusao = { originais, criados, extra: extra ? { ...extra } : null, dia, emp };
    mostrarDesfazer(`Relação de ${br(dia)} do ${EMP[emp]} excluída (${pl(afetadas.length, "apto")}).`);
  }
}
async function desfazerExclusao() {
  const u = ultimaExclusao; if (!u) return;
  ultimaExclusao = null; esconderDesfazer();
  const ids = new Set(u.originais.map(r => r.id).concat(u.criados));
  db.reservas = db.reservas.filter(r => !ids.has(r.id)).concat(u.originais);
  if (u.extra) (db.avulsos[u.dia] ||= {})[u.emp] = u.extra;
  renderTudo();
  if (await Store.desfazerExclusao(u.originais, u.criados, u.extra, u.dia, u.emp)) toast("Exclusão desfeita: a relação voltou.");
}
let desfazerTimer = null;
function mostrarDesfazer(msg) {
  $("desfazerMsg").textContent = msg; $("barraDesfazer").hidden = false;
  clearTimeout(desfazerTimer); desfazerTimer = setTimeout(esconderDesfazer, 30000);
}
function esconderDesfazer() { $("barraDesfazer").hidden = true; ultimaExclusao = null; }

// ---------- eventos ----------
document.querySelectorAll("nav button[data-tab]").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button[data-tab]").forEach(x => x.classList.toggle("active", x === b));
  document.querySelectorAll("section.tab").forEach(s => s.classList.toggle("active", s.id === "tab-" + b.dataset.tab));
  if (b.dataset.tab === "relacao") renderRelacao();
});

$("dia").onchange = e => { if (e.target.value) { diaSel = e.target.value; renderRelacao(); } };
$("btnPrev").onclick = () => { diaSel = addDays(diaSel, -1); renderRelacao(); };
$("btnNext").onclick = () => { diaSel = addDays(diaSel, 1); renderRelacao(); };
$("btnHoje").onclick = () => { diaSel = hoje(); renderRelacao(); };
$("btnAmanha").onclick = () => { diaSel = addDays(hoje(), 1); renderRelacao(); };
$("semana").onclick = e => { const d = e.target.closest("[data-dia]"); if (d) { diaSel = d.dataset.dia; renderRelacao(); } };
$("listas").addEventListener("click", e => {
  const b = e.target.closest("[data-excluir]"); if (b) excluirRelacao(b.dataset.excluir, diaSel);
  const c = e.target.closest("[data-conf]"); if (c) alternarConferida(c.dataset.conf);
});
$("btnDesfazer").onclick = desfazerExclusao;
$("btnFecharDesfazer").onclick = esconderDesfazer;
$("listas").addEventListener("change", e => {
  const el = e.target; if (!el.dataset.ex) return;
  const emp = el.dataset.ex, dia = diaSel;
  ((db.avulsos[dia] ||= {})[emp] ||= {})[el.dataset.t] = Math.max(0, parseInt(el.value) || 0);
  el.blur(); renderRelacao(); Store.salvarExtra(dia, emp);
});
$("btnImprimir").onclick = imprimirRelacao;
$("btnImprimirRel").onclick = imprimirRelacao;
$("chkPedidoPrint").checked = localStorage.getItem("cafe-print-pedido") === "1";
$("chkPedidoPrint").onchange = e => localStorage.setItem("cafe-print-pedido", e.target.checked ? "1" : "0");
$("btnCopiar").onclick = async () => {
  const t = textoWhatsApp();
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  toast("Copiado! É só colar no WhatsApp.");
};

// importação de PDF
for (const k in EMP) $("pdfEmp").add(new Option(EMP[k], k));
if (EMP[localStorage.getItem("cafe-pdf-emp")]) $("pdfEmp").value = localStorage.getItem("cafe-pdf-emp");
$("pdfFile").onchange = e => { processarPdf(e.target.files[0]); e.target.value = ""; };
["dragenter", "dragover"].forEach(ev => $("pdfDrop").addEventListener(ev, e => { e.preventDefault(); $("pdfDrop").classList.add("over"); }));
["dragleave", "drop"].forEach(ev => $("pdfDrop").addEventListener(ev, e => { e.preventDefault(); $("pdfDrop").classList.remove("over"); }));
$("pdfDrop").addEventListener("drop", e => { e.stopPropagation(); irParaImportacao(); processarPdf(e.dataTransfer.files[0]); });
function irParaImportacao() {
  document.querySelector('nav button[data-tab="reservas"]').click();
  $("cardPdf").scrollIntoView({ behavior: "smooth", block: "start" });
}
// botão na tela principal: vai para o quadro de importação e já abre a escolha do arquivo
$("btnImportarPdf").onclick = () => { irParaImportacao(); $("pdfFile").click(); };
// soltar o PDF em qualquer lugar da página também funciona
window.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
window.addEventListener("drop", e => {
  const f = e.dataTransfer?.files?.[0]; if (!f) return;
  e.preventDefault();
  if (!$("login").hidden) { toast("Entre no sistema antes de importar o PDF."); return; }
  irParaImportacao(); processarPdf(f);
});
$("pdfRevisao").addEventListener("input", e => {
  const el = e.target; if (!imp || el.dataset.i === undefined) return;
  const it = imp.itens[+el.dataset.i], f = el.dataset.f;
  if (f === "conferida") { it.conferida = el.checked; it.mudou = false; if (!el.checked) { it.confEm = null; it.confPor = ""; } return; }
  it[f] = f === "cafe" ? el.value === "1" : el.value;
  if (f === "cafe") it.cafeMantido = false;
  if (f === "saida") it.saidaDefinida = true;
  if (f === "acomp") {   // junta os campos de acompanhante daquele apto num texto só
    delete it.acomp;
    const campos = [...document.querySelectorAll(`#pdfRevisao [data-i='${el.dataset.i}'][data-f='acomp']`)];
    it.acompanhante = juntarAcomp(campos.map(c => c.value));
    el.classList.toggle("falta", !el.value.trim());
  }
});
$("pdfRevisao").addEventListener("change", e => {
  const el = e.target; if (!imp) return;
  if (el.id === "impData") { if (el.value) { imp.data = el.value; prepararImportacao(); renderRevisao(); } return; }
  if (el.dataset.aus !== undefined) { imp.ausentes[+el.dataset.aus].encerrar = el.checked; return; }
  if (["cafe", "adultos", "criancas", "saida", "conferida"].includes(el.dataset.f)) renderRevisao(); // atualiza totais, cores e avisos
});
$("pdfEmp").addEventListener("change", () => { if (imp) { prepararImportacao(); renderRevisao(); } });
$("pdfRevisao").addEventListener("click", e => {
  if (!imp) return;
  if (e.target.dataset.rm !== undefined) { imp.itens.splice(+e.target.dataset.rm, 1); renderRevisao(); }
  if (e.target.id === "btnImpConfTodos") { imp.itens.forEach(i => { i.conferida = true; i.mudou = false; }); renderRevisao(); }
  if (e.target.id === "btnImpSalvar") salvarImportacao();
  if (e.target.id === "btnImpCancelar") { imp = null; renderRevisao(); }
});

// formulário de reserva
for (const k in EMP) { $("fEmp").add(new Option(EMP[k], k)); $("filtroEmp").add(new Option(EMP[k], k)); }
let editId = null;
// campos de acompanhante do cadastro manual (os nomes digitados ficam guardados mesmo se a quantidade mudar)
let acompForm = [];
const qtdAcompForm = () => Math.min(29, Math.max(num($("fAd").value) + num($("fCr").value) - 1, 0));
function renderAcompForm() {
  const qtd = qtdAcompForm(), box = $("fAcompBox");
  box.innerHTML = qtd
    ? Array.from({ length: qtd }, (_, j) => `<input data-acomp="${j}" placeholder="Acompanhante ${j + 1}" value="${esc(acompForm[j] || "")}">`).join("")
    : '<span class="hint" style="margin:0">Só o titular (1 pessoa) — sem acompanhantes.</span>';
}
$("fAcompBox").addEventListener("input", e => { const j = e.target.dataset.acomp; if (j !== undefined) acompForm[+j] = e.target.value; });
["fAd", "fCr"].forEach(id => $(id).addEventListener("input", renderAcompForm));
function limparForm() {
  editId = null; $("formRes").reset();
  $("fIn").value = hoje(); $("fOut").value = addDays(hoje(), 1);
  acompForm = []; renderAcompForm();
  $("formTitulo").textContent = "Nova reserva"; $("btnSalvar").textContent = "Adicionar"; $("btnCancelar").style.display = "none";
}
$("fIn").onchange = () => { if ($("fIn").value && (!$("fOut").value || $("fOut").value <= $("fIn").value)) $("fOut").value = addDays($("fIn").value, 1); };
$("formRes").onsubmit = async e => {
  e.preventDefault();
  const r = {
    id: editId || uid(), emp: $("fEmp").value, apto: $("fApto").value.trim(), reserva: $("fReserva").value.trim(), hospede: $("fHosp").value.trim(), acompanhante: juntarAcomp(acompForm.slice(0, qtdAcompForm())),
    adultos: Math.max(0, parseInt($("fAd").value) || 0), criancas: Math.max(0, parseInt($("fCr").value) || 0),
    checkin: $("fIn").value, checkout: $("fOut").value, cafe: $("fCafe").checked, obs: $("fObs").value.trim()
  };
  // saída confirmada: reserva digitada à mão, ou check-out alterado aqui; senão mantém como estava
  const orig = editId ? db.reservas.find(x => x.id === editId) : null;
  r.saida_definida = !orig || !saidaIncerta(orig) || r.checkout !== orig.checkout;
  if (orig) Object.assign(r, { conferida: !!orig.conferida, conferida_em: orig.conferida_em || null, conferida_por: orig.conferida_por || "" }); // editar não tira a marca
  if (r.checkout <= r.checkin) { toast("O check-out precisa ser depois do check-in."); return; }
  const faltam = Math.max(0, r.adultos + r.criancas - 1 - listaAcomp(r.acompanhante).length);
  if (faltam && !confirm(`O apto ${r.apto} tem ${r.adultos + r.criancas} pessoas, mas falta o nome de ${faltam} acompanhante(s).\n\nSalvar assim mesmo?`)) {
    const vazio = [...document.querySelectorAll("#fAcompBox input")].find(i => !i.value.trim()); if (vazio) vazio.focus(); return;
  }
  const editando = !!editId;
  if (editando) db.reservas = db.reservas.map(x => x.id === editId ? r : x); else db.reservas.push(r);
  const empAnterior = r.emp; limparForm(); $("fEmp").value = empAnterior; $("fApto").focus();
  renderTudo();
  if (await Store.salvarReserva(r)) toast(editando ? "Reserva atualizada." : `Apto ${r.apto} adicionado.`);
};
$("btnCancelar").onclick = limparForm;
// marcar / desmarcar "conferida" (vale na lista de reservas e na relação do dia)
async function alternarConferida(id) {
  const r = db.reservas.find(x => x.id === id); if (!r) return;
  const novo = { ...r, conferida: !r.conferida, conferida_em: !r.conferida ? new Date().toISOString() : null, conferida_por: !r.conferida ? (usuarioEmail || "este computador") : "" };
  db.reservas = db.reservas.map(x => x.id === id ? novo : x);
  renderReservas(); renderRelacao();
  if (await Store.salvarReserva(novo)) toast(novo.conferida ? `Apto ${novo.apto} conferido ✓` : `Apto ${novo.apto} voltou para pendente.`);
}
$("listaRes").onclick = async e => {
  const conf = e.target.closest("[data-conf]"); if (conf) { alternarConferida(conf.dataset.conf); return; }
  const ed = e.target.dataset.edit, del = e.target.dataset.del;
  if (ed) {
    const r = db.reservas.find(x => x.id === ed); if (!r) return;
    editId = r.id; $("fEmp").value = r.emp; $("fApto").value = r.apto; $("fReserva").value = r.reserva || ""; $("fHosp").value = r.hospede || "";
    $("fAd").value = r.adultos; $("fCr").value = r.criancas; acompForm = listaAcomp(r.acompanhante); renderAcompForm(); $("fIn").value = r.checkin; $("fOut").value = r.checkout;
    $("fCafe").checked = r.cafe; $("fObs").value = r.obs || "";
    $("formTitulo").textContent = `Editando apto ${r.apto}`; $("btnSalvar").textContent = "Salvar alterações"; $("btnCancelar").style.display = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (del) {
    const r = db.reservas.find(x => x.id === del);
    if (r && confirm(`Excluir a reserva do apto ${r.apto} (${EMP[r.emp]})?`)) {
      db.reservas = db.reservas.filter(x => x.id !== del); renderTudo();
      if (await Store.excluirReserva(del)) toast("Reserva excluída.");
    }
  }
};
["busca", "filtroEmp", "filtroPer"].forEach(id => $(id).addEventListener("input", renderReservas));

// importação por colar
$("btnImport").onclick = async () => {
  const linhas = $("txtImport").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const novas = [], erros = [];
  linhas.forEach((l, n) => {
    const c = l.split(l.includes("\t") ? "\t" : ";").map(x => x.trim());
    const empTxt = (c[0] || "").toLowerCase();
    const emp = empTxt.includes("9006") ? "9006" : empTxt.includes("madero") ? "madero" : null;
    const ci = parseData(c[5]), co = parseData(c[6]);
    if (!emp || !c[1] || !ci || !co || co <= ci) { erros.push(n + 1); return; }
    const cafeTxt = (c[8] || "").trim().toLowerCase();
    const cafe = !(cafeTxt === "n" || cafeTxt === "nao" || cafeTxt === "não" || cafeTxt === "sem" || cafeTxt === "sem café" || cafeTxt === "0");
    novas.push({ id: uid(), emp, apto: c[1], hospede: c[2] || "", acompanhante: c[7] || "", adultos: Math.max(0, parseInt(c[3]) || 0), criancas: Math.max(0, parseInt(c[4]) || 0), checkin: ci, checkout: co, cafe, obs: "" });
  });
  if (!novas.length) { toast("Nenhuma linha válida." + (erros.length ? ` Linhas com problema: ${erros.slice(0, 8).join(", ")}` : ""), 4000); return; }
  db.reservas.push(...novas); renderTudo();
  if (await Store.inserirReservas(novas)) {
    $("txtImport").value = "";
    toast(`${novas.length} reserva(s) importada(s)` + (erros.length ? ` · linhas ignoradas: ${erros.slice(0, 8).join(", ")}${erros.length > 8 ? "…" : ""}` : ""), 4000);
  }
};

// itens do pedido
$("listaItens").addEventListener("change", e => {
  const el = e.target; if (el.dataset.it === undefined) return;
  const it = db.itens[+el.dataset.it], f = el.dataset.f;
  it[f] = (f === "adulto" || f === "crianca") ? Math.max(0, parseFloat(el.value) || 0) : el.value.trim();
  renderRelacao(); Store.salvarConfig();
});
$("listaItens").onclick = e => {
  if (e.target.dataset.delit !== undefined) { db.itens.splice(+e.target.dataset.delit, 1); renderConfig(); renderRelacao(); Store.salvarConfig(); }
};
$("btnAddItem").onclick = () => { db.itens.push({ nome: "", un: "un", adulto: 1, crianca: 0 }); renderConfig(); Store.salvarConfig(); };
$("margem").onchange = e => { db.margem = Math.max(0, parseFloat(e.target.value) || 0); e.target.blur(); renderRelacao(); Store.salvarConfig(); };

// backup
$("btnExport").onclick = () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `backup-cafe-${hoje()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("fileImport").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const fr = new FileReader();
  fr.onload = async () => {
    e.target.value = "";
    let d;
    try { d = JSON.parse(fr.result); if (!Array.isArray(d.reservas)) throw 0; }
    catch (err) { toast("Arquivo de backup inválido."); return; }
    d = Object.assign(novoDB(), d);
    if (ONLINE) {
      if (!confirm(`Enviar ${d.reservas.length} reservas deste backup para o banco? Reservas iguais (mesmo código) serão atualizadas; as outras continuam lá.`)) return;
      if (await Store.enviarTudo(d)) { toast("Backup enviado ao banco."); agendarRecarga(); }
    } else {
      if (!confirm(`Restaurar backup com ${d.reservas.length} reservas? Os dados atuais serão substituídos.`)) return;
      db = d; await gravar(); renderTudo(); toast("Backup restaurado.");
    }
  };
  fr.readAsText(f);
};
$("btnMigrar").onclick = async () => {
  const local = lerLocal(); if (!local) return;
  if (!confirm(`Enviar ao banco ${pl(local.reservas.length, "reserva")} que estavam salvas só neste navegador?`)) return;
  $("btnMigrar").disabled = true;
  if (await Store.enviarTudo(local)) {
    localStorage.setItem(KEY + "-migrado-" + hoje(), localStorage.getItem(KEY));
    localStorage.removeItem(KEY);
    toast("Dados enviados ao banco!"); agendarRecarga();
  }
  $("btnMigrar").disabled = false;
};
$("btnLimparAntigas").onclick = async () => {
  const lim = addDays(hoje(), -30), n = db.reservas.filter(r => r.checkout < lim).length;
  if (!n) { toast("Nenhuma reserva antiga para apagar."); return; }
  if (confirm(`Apagar ${pl(n, "reserva")} com check-out antes de ${br(lim)}? Não dá para desfazer.`)) {
    db.reservas = db.reservas.filter(r => r.checkout >= lim);
    for (const d in db.avulsos) if (d < lim) delete db.avulsos[d];
    renderTudo();
    if (await Store.apagarAntigas(lim)) toast(`${pl(n, "reserva")} apagada(s).`);
  }
};

// ---------- login / sessão (modo online) ----------
let sessaoAtiva = false, canal = null;
function mostrarLogin(msg) { $("login").hidden = false; $("lErro").textContent = msg || ""; setTimeout(() => $("lEmail").focus(), 50); }
async function iniciarSessao() {
  sessaoAtiva = true; $("login").hidden = true; $("btnSair").hidden = false;
  setStatus("wait", "carregando…");
  try { await carregar(); setStatus("ok", "online"); }
  catch (err) { console.error(err); setStatus("err", "erro ao carregar"); toast("Erro ao carregar do banco: " + (err.message || err), 6000); }
  if (!canal) {
    canal = sb.channel("cafe-mudancas");
    for (const t of ["reservas", "extras", "config"]) canal.on("postgres_changes", { event: "*", schema: "public", table: t }, agendarRecarga);
    canal.subscribe();
  }
}
function encerrarSessao() {
  sessaoAtiva = false; $("btnSair").hidden = true;
  if (canal) { sb.removeChannel(canal); canal = null; }
  db = novoDB(); renderTudo(); setStatus("err", "desconectado"); mostrarLogin();
}
$("formLogin").onsubmit = async e => {
  e.preventDefault();
  $("btnEntrar").disabled = true; $("lErro").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lSenha").value });
  $("btnEntrar").disabled = false;
  if (error) { $("lErro").textContent = /invalid/i.test(error.message) ? "E-mail ou senha incorretos." : error.message; return; }
  $("lSenha").value = "";
};
$("btnSair").onclick = () => { if (confirm("Sair deste computador?")) sb.auth.signOut(); };

async function iniciar() {
  limparForm();
  renderTudo();
  if (!CONFIGURADO) { setStatus("", "modo local (só este PC)"); return; }
  if (!sb) {
    setStatus("err", "sem internet");
    mostrarLogin("Não foi possível carregar a conexão com o banco. Verifique a internet e aperte F5.");
    $("btnEntrar").disabled = true; return;
  }
  sb.auth.onAuthStateChange((evento, sessao) => {
    // adia para fora do callback (recomendação do Supabase)
    usuarioEmail = (sessao && sessao.user && sessao.user.email) || "";
    setTimeout(() => {
      if (sessao && !sessaoAtiva) iniciarSessao();
      else if (!sessao && sessaoAtiva) encerrarSessao();
    }, 0);
  });
  const { data } = await sb.auth.getSession();
  if (!data.session) { setStatus("err", "faça login"); mostrarLogin(); }
  // recarrega ao voltar para a janela e a cada 2 min (garantia caso o tempo real caia)
  window.addEventListener("focus", agendarRecarga);
  setInterval(agendarRecarga, 120000);
}

// atualiza "hoje/amanhã" se a página ficar aberta virando a noite
let ultimoHoje = hoje();
setInterval(() => { if (hoje() !== ultimoHoje) { ultimoHoje = hoje(); diaSel = addDays(ultimoHoje, 1); renderRelacao(); } }, 60000);

iniciar();
