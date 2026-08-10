// ============================================================
// Pipeline PDF — frontend
// Consome o endpoint /api/status da Function e monta o painel.
// ============================================================

// Base da API. Em desenvolvimento local, aponta pro func start.
// No deploy, troque pela URL da Function na nuvem (veja README).
const API_BASE = "https://func-rafael-pipeline.azurewebsites.net/api";
const API_URL = `${API_BASE}/status`;

// Intervalo de atualizacao automatica (ms). O pipeline nao e instantaneo,
// entao um polling a cada 8s mantem a tela fresca sem martelar a API.
const POLL_MS = 8000;

// --- Referencias de elementos ---
const elDocs = document.getElementById("docs");
const elEmpty = document.getElementById("empty");
const elError = document.getElementById("error");
const elErrorDetail = document.getElementById("error-detail");
const elSummary = document.getElementById("summary");
const elStatusLine = document.getElementById("status-line");
const elStatusText = document.getElementById("status-text");
const elRefresh = document.getElementById("refresh");

// Stats do sumario
const elStatDocs = document.getElementById("stat-docs");
const elStatPages = document.getElementById("stat-pages");
const elStatTokens = document.getElementById("stat-tokens");
const elStatCost = document.getElementById("stat-cost");

// --- Helpers de formatacao ---

// Formata numero com separador de milhar (pt-BR).
function fmtNum(n) {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR");
}

// Formata custo em USD com 4 casas (custos aqui sao pequenos).
function fmtCost(v) {
  if (v == null) return "—";
  return "$" + v.toFixed(4);
}

// Formata duracao em segundos.
function fmtDur(s) {
  if (s == null) return "—";
  return s.toFixed(1) + "s";
}

// Escapa texto pra evitar injecao de HTML ao montar os cards.
function esc(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

// --- Montagem de um card de documento ---

function montarCard(doc) {
  const meta = doc.metadata;
  const arquivos = doc.arquivos || {};

  // Metricas (so aparecem se houver metadata).
  let metricasHtml = "";
  if (meta) {
    const ext = meta.extracao || {};
    const trad = meta.traducao || {};
    const proc = meta.processamento || {};
    const custo = meta.custos_estimados_usd || {};

    metricasHtml = `
      <div class="doc-metrics">
        <div class="metric">
          <span class="metric-label">Páginas</span>
          <span class="metric-value">${fmtNum(ext.paginas)}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Tabelas</span>
          <span class="metric-value">${fmtNum(ext.tabelas)}</span>
        </div>
        <div class="metric metric--tokens">
          <span class="metric-label">Tokens</span>
          <span class="metric-value">${fmtNum(trad.tokens_total)}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Duração</span>
          <span class="metric-value">${fmtDur(proc.duracao_segundos)}</span>
        </div>
        <div class="metric metric--cost">
          <span class="metric-label">Custo est.</span>
          <span class="metric-value">${fmtCost(custo.total)}</span>
        </div>
      </div>`;
  }

  // Botoes de download (so pros arquivos que existem).
  const botoes = [];
  if (arquivos["fiel.docx"]) {
    botoes.push(`<a class="dl dl--fiel" href="${arquivos["fiel.docx"]}" target="_blank" rel="noopener">
      <span class="dl-glyph">◆</span> DOCX fiel</a>`);
  }
  if (arquivos["traduzido.docx"]) {
    botoes.push(`<a class="dl dl--trad" href="${arquivos["traduzido.docx"]}" target="_blank" rel="noopener">
      <span class="dl-glyph">◆</span> DOCX traduzido</a>`);
  }
  if (arquivos["metadata.json"]) {
    botoes.push(`<a class="dl dl--json" href="${arquivos["metadata.json"]}" target="_blank" rel="noopener">
      <span class="dl-glyph">{ }</span> metadata.json</a>`);
  }

  const nomeArquivo = meta && meta.arquivo ? meta.arquivo.nome : doc.nome;

  const card = document.createElement("article");
  card.className = "doc-card";
  card.innerHTML = `
    <div class="doc-head">
      <div class="doc-title">
        <span class="doc-icon">PDF</span>
        <span class="doc-name">${esc(nomeArquivo)}</span>
      </div>
      <span class="doc-badge">Concluído</span>
    </div>
    ${metricasHtml}
    <div class="doc-actions">${botoes.join("")}</div>
  `;
  return card;
}

// --- Atualiza o sumario agregado ---

function atualizarSumario(documentos) {
  let pages = 0, tokens = 0, cost = 0, comMeta = 0;
  for (const doc of documentos) {
    if (!doc.metadata) continue;
    comMeta++;
    pages += doc.metadata.extracao?.paginas || 0;
    tokens += doc.metadata.traducao?.tokens_total || 0;
    cost += doc.metadata.custos_estimados_usd?.total || 0;
  }
  elStatDocs.textContent = fmtNum(documentos.length);
  elStatPages.textContent = fmtNum(pages);
  elStatTokens.textContent = fmtNum(tokens);
  elStatCost.textContent = fmtCost(cost);
  elSummary.hidden = documentos.length === 0;
}

// --- Renderiza o estado completo ---

function render(documentos) {
  elError.hidden = true;
  elDocs.innerHTML = "";

  if (!documentos || documentos.length === 0) {
    elEmpty.hidden = false;
    elSummary.hidden = true;
    elStatusText.textContent = "Pipeline no ar · aguardando documentos";
    return;
  }

  elEmpty.hidden = true;
  for (const doc of documentos) {
    elDocs.appendChild(montarCard(doc));
  }
  atualizarSumario(documentos);

  const agora = new Date().toLocaleTimeString("pt-BR");
  elStatusText.textContent = `Pipeline no ar · ${documentos.length} documento(s) · atualizado ${agora}`;
}

// --- Busca os dados no endpoint ---

async function carregar() {
  elRefresh.classList.add("spinning");
  try {
    const resp = await fetch(API_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dados = await resp.json();
    elStatusLine.classList.remove("is-error");
    render(dados.documentos || []);
  } catch (err) {
    // Falha de rede/API: mostra o estado de erro sem quebrar a tela.
    elStatusLine.classList.add("is-error");
    elStatusText.textContent = "Sem conexão com o pipeline";
    elEmpty.hidden = true;
    elError.hidden = false;
    elErrorDetail.textContent =
      "Verifique se a Function está no ar (func start localmente, ou o deploy na nuvem) e se a API_URL no app.js está correta. Detalhe: " + err.message;
  } finally {
    elRefresh.classList.remove("spinning");
  }
}

// ============================================================
// Upload de PDF pela interface
// Fluxo: pede um SAS de escrita ao backend -> sobe o PDF direto
// pro Storage -> o Blob trigger dispara o pipeline sozinho.
// ============================================================

const elDrop = document.getElementById("drop-zone");
const elFileInput = document.getElementById("file-input");
const elUploadState = document.getElementById("upload-state");
const elUploadFill = document.getElementById("upload-fill");
const elUploadMsg = document.getElementById("upload-msg");

// Sanitiza o nome do arquivo: sem espacos/acentos que quebrem o blob name.
function nomeSeguro(nome) {
  const semAcento = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return semAcento.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function mostrarUploadMsg(texto, tipo) {
  elUploadMsg.textContent = texto;
  elUploadMsg.className = "upload-msg" + (tipo ? " is-" + tipo : "");
}

async function enviarPdf(file) {
  if (!file) return;

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    elUploadState.hidden = false;
    elUploadFill.style.width = "100%";
    mostrarUploadMsg("Somente arquivos PDF são aceitos.", "error");
    return;
  }

  const nome = nomeSeguro(file.name);
  elUploadState.hidden = false;
  elUploadFill.style.width = "10%";
  mostrarUploadMsg(`Preparando envio de ${nome}…`, null);

  try {
    // 1) Pede o SAS de escrita ao backend.
    const respSas = await fetch(`${API_BASE}/upload-url?filename=${encodeURIComponent(nome)}`, {
      cache: "no-store",
    });
    if (!respSas.ok) throw new Error(`Falha ao obter URL de upload (HTTP ${respSas.status})`);
    const { uploadUrl, erro } = await respSas.json();
    if (erro) throw new Error(erro);

    elUploadFill.style.width = "35%";
    mostrarUploadMsg(`Enviando ${nome}…`, null);

    // 2) Sobe o PDF direto pro Storage usando o SAS.
    // O header x-ms-blob-type e obrigatorio pra criar block blob via PUT.
    const respPut = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": "application/pdf",
      },
      body: file,
    });
    if (!respPut.ok) throw new Error(`Falha no upload pro Storage (HTTP ${respPut.status})`);

    elUploadFill.style.width = "100%";
    mostrarUploadMsg(`${nome} enviado! O pipeline está processando…`, "done");

    // 3) Dispara uma atualizacao logo, e outra depois de alguns segundos
    // (tempo do pipeline rodar), pra o card aparecer sem esperar o polling.
    setTimeout(carregar, 2000);
    setTimeout(carregar, 12000);
    setTimeout(carregar, 20000);

    // Limpa a barra depois de um tempo.
    setTimeout(() => { elUploadState.hidden = true; elUploadFill.style.width = "0%"; }, 8000);
  } catch (err) {
    elUploadFill.style.width = "100%";
    mostrarUploadMsg("Erro no envio: " + err.message, "error");
  }
}

// Clique abre o seletor de arquivo.
elDrop.addEventListener("click", () => elFileInput.click());
elDrop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elFileInput.click(); }
});
elFileInput.addEventListener("change", (e) => {
  if (e.target.files.length) enviarPdf(e.target.files[0]);
  elFileInput.value = ""; // permite reenviar o mesmo arquivo
});

// Drag and drop.
["dragenter", "dragover"].forEach((ev) =>
  elDrop.addEventListener(ev, (e) => { e.preventDefault(); elDrop.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((ev) =>
  elDrop.addEventListener(ev, (e) => { e.preventDefault(); elDrop.classList.remove("dragover"); })
);
elDrop.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) enviarPdf(file);
});

// --- Eventos e polling ---

elRefresh.addEventListener("click", carregar);
carregar();
setInterval(carregar, POLL_MS);
