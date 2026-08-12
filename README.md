# Pipeline PDF — Extração, Tradução e Telemetria na Azure


Pipeline serverless *event-driven* que recebe um PDF, extrai seu conteúdo com fidelidade estrutural, traduz para inglês e gera um relatório de telemetria — tudo disparado automaticamente no momento em que o arquivo chega, sem intervenção manual.

O projeto integra quatro serviços da Azure (Functions, Storage, Document Intelligence e OpenAI) e entrega uma interface web para enviar PDFs e acompanhar os resultados.

**🔗 [Acessar a aplicação](https://witty-bush-0d8824c0f.7.azurestaticapps.net/)**
---

## O que a aplicação faz

A partir de um único PDF, o pipeline produz três artefatos:

1. **DOCX fiel** — reconstrói o documento original em Word preservando títulos, parágrafos, tabelas e a ordem do conteúdo.
2. **DOCX traduzido** — o mesmo documento vertido para o inglês, mantendo a estrutura.
3. **JSON de telemetria** — metadados do processamento, consumo de tokens e custos estimados de cada etapa.

O gatilho é um evento de storage: assim que o PDF chega no container de entrada, uma Azure Function é acionada e executa todo o fluxo de ponta a ponta.

---

## Arquitetura

```
                          ┌─────────────────────────────────────────────┐
                          │            Frontend (Static Web App)         │
                          │  arrasta PDF  ·  acompanha  ·  baixa saídas  │
                          └───────────────┬──────────────┬──────────────┘
                     (1) pede SAS de escrita │              │ (5) lê /status a cada 8s
                                            ▼              ▼
   ┌────────────┐   (2) upload    ┌──────────────────────────────────────┐
   │  Usuário   │ ──────────────► │        Azure Blob Storage             │
   └────────────┘                 │  container "entrada"   "saida"        │
                                  └──────────┬───────────────▲───────────┘
                                (3) Blob trigger │               │ (persistência)
                                                 ▼               │
                                  ┌──────────────────────────────────────┐
                                  │        Azure Function (Python)        │
                                  │  processar_pdf · status · upload-url  │
                                  └───┬────────────────┬─────────────────┘
                          (4a) extrai │       (4b) traduz │
                                      ▼                  ▼
                        ┌──────────────────┐   ┌────────────────────┐
                        │ Document         │   │ Azure OpenAI       │
                        │ Intelligence     │   │ (gpt-5-mini)       │
                        │ prebuilt-layout  │   │                    │
                        └──────────────────┘   └────────────────────┘
```

**Fluxo:** o usuário arrasta um PDF na interface, que pede ao backend uma URL de escrita temporária (SAS) e envia o arquivo direto para o container `entrada`. A chegada do blob dispara o *Blob trigger* da Function, que extrai o conteúdo com o Document Intelligence (modelo `prebuilt-layout`, saída em Markdown com tabelas em HTML), monta o DOCX fiel, traduz o texto com o Azure OpenAI, monta o DOCX traduzido, calcula a telemetria e grava os três artefatos no container `saida`. O frontend consulta o endpoint de status periodicamente e exibe cada documento processado com suas métricas e links de download.

---

## Serviços utilizados

| Serviço | Papel no pipeline |
|---|---|
| **Azure Functions** (Python) | Orquestra o fluxo; o Blob trigger torna o pipeline event-driven |
| **Azure Blob Storage** | Entrada (`entrada`), saída (`saida`) e origem do gatilho |
| **Azure Document Intelligence** | Extrai texto, tabelas e estrutura com o modelo `prebuilt-layout` |
| **Azure OpenAI** (`gpt-5-mini`) | Traduz o conteúdo preservando a formatação |
| **Azure Static Web Apps** | Hospeda a interface de envio e acompanhamento |

---

## Estrutura do repositório

```
desafio-pipeline/
├── backend/
│   ├── function_app.py      # trigger + endpoints HTTP (status, upload-url)
│   ├── requirements.txt     # dependências Python
│   └── host.json            # configuração do host das Functions
└── frontend/
    ├── index.html           # interface (upload + painel de telemetria)
    ├── style.css            # estilos
    └── app.js               # lógica: upload via SAS + polling do status
```

> `local.settings.json` não é versionado — contém endpoints e chaves. As variáveis são configuradas como *application settings* na Function.

---

## Endpoints da Function

| Rota | Método | Função |
|---|---|---|
| *(Blob trigger)* | — | Processa cada PDF que chega no container `entrada` |
| `/api/status` | GET | Lista os documentos processados, com métricas e links SAS de leitura |
| `/api/upload-url` | GET | Gera um SAS de escrita temporário para o frontend enviar um PDF |

---

## Como executar localmente

**Pré-requisitos:** Python 3.11, Azure Functions Core Tools v4, Azure CLI autenticado.

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1        # Windows PowerShell
pip install -r requirements.txt
```

Crie um `local.settings.json` em `backend/` com as variáveis:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "<connection string do storage>",
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "PDF_STORAGE": "<connection string do storage>",
    "DOCINT_ENDPOINT": "<endpoint do Document Intelligence>",
    "DOCINT_KEY": "<chave do Document Intelligence>",
    "OPENAI_ENDPOINT": "<endpoint do Azure OpenAI>",
    "OPENAI_KEY": "<chave do Azure OpenAI>",
    "OPENAI_DEPLOYMENT": "gpt-5-mini"
  }
}
```

Rode a Function:

```bash
func start
```

Para o frontend, ajuste `API_BASE` em `frontend/app.js` para `http://localhost:7071/api` e abra o `index.html` (ou sirva a pasta com uma extensão como Live Server). Envie um PDF pela interface — o pipeline processa e o resultado aparece no painel.

---

## Decisões técnicas

**Isolamento de recursos.** Todos os recursos vivem num único resource group (`rg-rafael-pipeline`), incluindo instâncias próprias de OpenAI e Storage em vez de reaproveitar recursos de outros projetos. Isso torna o custo rastreável por projeto, permite uma deleção limpa ao final e evita que uma alteração de chave afete sistemas não relacionados.

**Fidelidade estrutural, não pixel-perfect.** O objetivo do DOCX fiel é reproduzir a estrutura lógica (títulos, parágrafos, tabelas, ordem), que cobre o requisito com robustez. O modelo `prebuilt-layout` entrega o conteúdo em Markdown com tabelas em HTML, o que facilita reconstruir o documento sem depender de coordenadas absolutas.

**OCR de alta resolução.** O add-on `ocrHighResolution` é habilitado para melhorar a leitura de texto denso e símbolos ambíguos, priorizando fidelidade.

**Simplicidade deliberada.** O idioma de destino é fixo (inglês), sem parametrização configurável — o requisito pede um idioma, e uma camada de configuração adicional resolveria um problema que o escopo não tem.

**Telemetria a partir de dados reais.** O consumo de tokens vem diretamente do campo `usage` retornado pelo OpenAI; os custos são estimados sobre uma tabela de preços mantida como constante explícita no código, fácil de ajustar.

---

## Exemplo de telemetria

Saída real do processamento de um formulário fiscal de 2 páginas com 6 tabelas:

```json
{
  "extracao": { "paginas": 2, "tabelas": 6, "caracteres_extraidos": 9375 },
  "traducao": {
    "modelo": "gpt-5-mini",
    "tokens_input": 3100,
    "tokens_output": 3227,
    "tokens_total": 6327
  },
  "custos_estimados_usd": {
    "document_intelligence": 0.02,
    "openai_total": 0.007229,
    "total": 0.027229
  }
}
```

Um dado interessante que a telemetria revela: em documentos curtos, a extração (custo por página) pesa mais que a tradução (custo por token). Instrumentar o pipeline torna esse tipo de trade-off visível.

---

## Limitações conhecidas

- **Caracteres não-textuais.** Emojis e símbolos gráficos podem não ser reconhecidos corretamente pelo OCR. Documentos textuais convencionais não são afetados.
- **CORS aberto para testes.** A política de CORS do Storage e dos endpoints usa origem `*` para facilitar o desenvolvimento. Em produção, seria restrita à origem do frontend.

---

## Autor

Rafael Tomiazi — [github.com/RafaelTomiazi](https://github.com/RafaelTomiazi)
