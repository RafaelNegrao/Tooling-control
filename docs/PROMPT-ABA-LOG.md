# Prompt: replicar aba de Log / Auditoria

> Cole tudo abaixo na outra IA. Ajuste apenas a seção "CONTEXTO DO MEU SISTEMA".

---

## CONTEXTO DO MEU SISTEMA

- Stack: **[PREENCHER — ex.: Electron 28 + SQLite / React + Node + Postgres / Django ...]**
- Camada por onde passam as alterações de dados: **[PREENCHER — ex.: handlers IPC / rotas REST / service layer]**
- Áreas/módulos que precisam ser auditados: **[PREENCHER — ex.: Cadastro, Relatórios, Configurações]**
- Idioma da interface: **[PREENCHER — ex.: inglês]**
- Cor de destaque da marca: **[PREENCHER — ex.: #c8102e]**

---

## O QUE EU QUERO

Uma aba de **Log de Alterações (audit log)** que registre automaticamente toda e
qualquer alteração de dados do sistema, junto com o **usuário do sistema
operacional** que fez a alteração, e uma tela para consultar esses registros com
uma tabela à esquerda e um painel de detalhe em JSON à direita.

Não use nenhuma biblioteca nova: nem ORM, nem lib de tabela/grid, nem lib de
gráficos, nem highlighter de JSON. Tudo em JS puro, SQL puro e CSS puro, usando
só o que o projeto já tem. O ícone pode vir do icon set já usado no projeto.

---

## 1. ARQUITETURA — ORIENTADA A OBJETOS, EM 2 ARQUIVOS

### Arquivo A: `audit-logger.js` (genérico, reaproveitável)

Seis classes:

**`SystemUser`** — identifica quem está usando a máquina.
- Lê `os.userInfo().username`, com fallback para `process.env.USERNAME` / `USER`.
- Também captura domínio (`process.env.USERDOMAIN`), hostname (`os.hostname()`) e plataforma.
- Getter `displayName` → `"DOMINIO\\usuario"` quando há domínio.
- Singleton via `static current()`, com `refresh()` para reler.

**`AuditSanitizer`** — deixa qualquer valor seguro e compacto antes de virar JSON.
- `static sanitize(value, depth, key)`:
  - trunca strings acima de **600 chars** com sufixo `" [+N chars]"`;
  - se a **chave** casar com `/(base64|password|senha|token|secret|buffer|blob|dataurl|comment)/i` e a string tiver mais de 120 chars, substitui por `"[omitted N chars]"` (evita gravar imagens em base64 e blobs de comentários);
  - arrays: no máximo **60 itens**, com `"[+N items]"` no fim;
  - profundidade máxima **8** (`"[max depth reached]"`);
  - trata `Date` → ISO, `Error` → `{name, message}`, `Buffer` → `"[buffer N bytes]"`, `bigint` → string, função/símbolo → `"[function]"`.
- `static stringify(value)` → JSON.stringify do valor já sanitizado, com try/catch.

**`AuditDiff`** — compara dois snapshots e devolve só o que mudou.
- `normalize`: `null`, `undefined` e `""` viram o mesmo valor; boolean vira 0/1; string sofre `trim`.
- `isEqual`: compara normalizado e, se ambos forem numéricos, compara como número (`"100"` == `100`).
- `static compare(before, after, fields?)` → `[{ field, from, to }]`, opcionalmente restrito a uma lista de campos.

**`AuditEntry`** — value object de um evento; normaliza os campos e produz a linha do INSERT (`toRow()`). Guarda timestamp ISO **e** um timestamp local formatado `DD/MM/AAAA HH:MM:SS`.

**`AuditLogger`** — persistência e consulta.
- Recebe um `executor` com `run/get/all` (a mesma conexão do banco do app, não abra uma segunda conexão).
- `ensureTable()` idempotente e lazy (cria tabela + índices na primeira escrita).
- `record(data)` — **nunca lança exceção e nunca rejeita**: auditoria não pode quebrar a operação de negócio. Usa uma **fila serializada** (`this.writeQueue = this.writeQueue.then(...)`) para não intercalar escritas.
- `query(filters)` — paginação (`page`, `pageSize`, default 50, teto 500) e filtros combináveis: categoria, ação, usuário, status, data inicial, data final e busca textual (`LIKE` em summary, entity, entity_id, usuário, details e channel).
- `getById(id)` — devolve a entrada com `details` já parseado.
- `getFilterOptions()` — valores distintos de usuário, categoria e ação, para popular os selects.
- `getStats()` — total, nº de usuários distintos, nº de erros, primeira/última data e contagem por categoria.
- `exportEntries(filters)` — mesmos filtros, sem paginação, teto 10.000.
- `clear(filters)` — apaga respeitando os filtros ativos.
- Retenção: mantém no máximo **20.000** registros, apagando os mais antigos; roda só a cada 200 inserções para não pesar.
- `onRecord(listener)` — permite notificar a UI de que chegou registro novo.

**`IpcAuditInterceptor`** — o coração da solução.
- **Não espalhe chamadas de log pelo código.** Em vez disso, envolva de forma centralizada a camada por onde toda alteração passa.
- No Electron: substitua `ipcMain.handle` por uma versão que consulta um registro de descritores; se o canal estiver mapeado, embrulha o handler. **A instalação tem que acontecer ANTES do registro dos handlers.**
- Em outra stack, aplique a mesma ideia: middleware Express, interceptor de service layer, decorator, etc.
- O wrapper faz, em ordem: captura o snapshot **antes** → executa o handler original → captura o snapshot **depois** → calcula o diff → grava o log → **re-lança o erro original se houve** (o comportamento visível do app não muda em nada).
- Erros de auditoria são capturados e apenas logados no console.

### Arquivo B: `audit-channels.js` (mapa específico do domínio)

Registro declarativo `canal -> descritor`. Cada descritor pode ter:

| Campo | Função |
|---|---|
| `category` | área do sistema (usei: `tooling`, `analytics`, `settings`, `system`) |
| `action` | `create`, `update`, `delete`, `import`, `export`, `rename`, `email`, `clear`, `session` |
| `entity` | nome legível da entidade; pode ser função para variar (ex.: `Picture` vs `Attachment`) |
| `entityId` | identificador do registro afetado |
| `summary` | texto curto da coluna "Change" |
| `before(...args)` | snapshot anterior (ex.: buscar o registro pelo id antes do update) |
| `after(result, ...args)` | snapshot posterior |
| `changes(ctx)` | diff customizado |
| `shouldLog(ctx)` | evita gravar quando nada mudou de fato |
| `requestArgs(ctx)` | versão enxuta dos argumentos (para omitir payloads gigantes) |
| `extraDetails(ctx)` | campos extras no JSON |

Regras importantes que quero replicadas:

1. **Só canais de escrita entram no mapa.** Leituras (listagens, buscas) não geram log.
2. **Update sem mudança real não vira registro** — `shouldLog` retorna `false` quando o diff está vazio.
3. **Campos automáticos saem do diff** (ex.: `last_update`), senão todo update parece ter mudado algo.
4. **Campos-blob viram resumo.** No meu caso o campo `comments` guarda um JSON grande; no log ele vira `{ from: "1 comment(s)", to: "2 comment(s)", added: [...] }` em vez do texto inteiro.
5. **Nome de arquivo em anexos.** Operações de upload/delete devem registrar o **nome do arquivo/imagem**, lido do retorno do handler (que é quem sabe o que foi gravado em disco). Uploads parciais listam os que entraram e colocam os que falharam em `failedFiles`.
6. **Cancelamento não é alteração.** Se o usuário cancelou o diálogo de arquivo, não grave nada.
7. Operações que devolvem a pasta inteira (em vez do item adicionado) descobrem o nome novo **comparando a listagem antes e depois**.

### Alterações que não passam pela camada interceptada

Para o que é salvo só no cliente (ex.: `localStorage`), exponha um canal manual
`audit-record` e chame explicitamente nesses pontos, passando
`{ category, action, entity, entityId, summary, changes, before, after }`.

### Registre também o início de sessão

Quando o app abre, grave `category: 'system'`, `action: 'session'`,
summary `"Application opened by DOMINIO\\usuario"`.

---

## 2. ESQUEMA DA TABELA

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,   -- ISO 8601, usado para ordenar e filtrar
  timestamp_local TEXT,           -- DD/MM/AAAA HH:MM:SS, usado para exibir
  windows_user   TEXT,
  user_domain    TEXT,
  machine        TEXT,
  app_version    TEXT,
  category       TEXT,            -- tooling | analytics | settings | system
  action         TEXT,            -- create | update | delete | import | export | ...
  entity         TEXT,
  entity_id      TEXT,
  summary        TEXT,
  status         TEXT,            -- success | error
  channel        TEXT,            -- canal/rota de origem
  origin         TEXT,            -- ipc | renderer | main
  duration_ms    INTEGER,
  changes_count  INTEGER,
  details        TEXT             -- JSON completo
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_category  ON audit_log(category);
CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_log(windows_user);
```

O campo `details` guarda:
`{ request, before, after, changes: [{field, from, to}], result, error }`.

---

## 3. API ENTRE UI E BACKEND

- `get-current-user` → dados do usuário do SO (para o header)
- `audit-query(filters)` → `{ success, rows, total, page, pageSize, totalPages }`
- `audit-get-entry(id)` → `{ success, entry }` com `details` parseado
- `audit-filter-options()` → `{ users, categories, actions }`
- `audit-stats()` → totais e contagem por categoria
- `audit-record(payload)` → registro manual vindo do cliente
- `audit-export(filters)` → salva um `.json` com `{ exportedAt, exportedBy, filters, total, entries }`
- `audit-clear(filters)` → apaga respeitando os filtros; **grava um log dizendo quantos foram apagados**
- push `audit-log-appended` → avisa a UI que chegou registro novo

---

## 4. LAYOUT DA ABA

Um card ocupando **toda a altura disponível**, em coluna:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Change Log                          [Refresh] [Export JSON] [Clear]    │
│ Every data change made in <áreas>, with the user responsible for it.   │
├────────────────────────────────────────────────────────────────────────┤
│ (Total: 128) (Users: 3) (tooling: 90) (settings: 30) (Errors: 2)       │  ← chips
├────────────────────────────────────────────────────────────────────────┤
│ [🔍 buscar...] [área ▾] [ação ▾] [usuário ▾] [de 📅] [até 📅] [✕]      │  ← filtros
├──────────────────────────────────────────┬─────────────────────────────┤
│  #  DATE/TIME  USER  AREA  ACTION  ...   │  ▣ Record detail            │
│ ─────────────────────────────────────── │     #27616                  │
│  21  19/08 08:03  Rafael  SYSTEM  ...    │ ─────────────────────────── │
│  20  ...                                 │  Date / time  17/08 20:00   │
│  19  ...                          [{}]   │  User         RAFAEL        │
│           (rola só aqui)                 │  Machine      PCRAFAEL      │
│                                          │  Action       UPDATE        │
│                                          │  Area         SETTINGS      │
│                                          │  Entity       Supplier      │
│                                          │  Entity ID    10            │
│                                          │  Description  ...           │
│                                          │                             │
│                                          │  DETAILS                    │
│                                          │  ┌───────────────────────┐  │
│                                          │  │ { JSON enxuto }       │  │
│                                          │  └───────────────────────┘  │
├──────────────────────────────────────────┤                             │
│ 1-50 de 128 — página 1/3   [50/pág] ‹ ›  │                             │
└──────────────────────────────────────────┴─────────────────────────────┘
```

**Proporções:** tabela `flex: 1 1 62%`, painel de detalhe `flex: 1 1 38%`
(mínimo 320px). Abaixo de 1200px, empilhar em coluna.

### Tabela

- Colunas: `#`, `Date / Time`, `User`, `Area`, `Action`, `Entity`, `Change`, `JSON`.
- Larguras fixas (`table-layout: fixed`), só a coluna `Change` é flexível e
  trunca com reticências + `title` completo.
- `Area` é um **badge colorido** por categoria; `Action` é **texto colorido** por tipo
  (create=verde, update=azul, delete=vermelho, import=âmbar, export=teal,
  rename=roxo, clear=vermelho, email=azul-claro, session=cinza).
- Coluna `JSON` tem um botão de ícone que abre o detalhe (a linha inteira
  também é clicável).
- Linha selecionada fica destacada; linha com `status = error` mostra o texto em vermelho.
- **O cabeçalho NÃO pode ficar dentro da área que rola** — ver seção 6.
- Paginação no rodapé: `"1-50 of 128 — page 1/3"`, seletor 25/50/100/200 e setas
  que desabilitam nos extremos.
- Estados: "Loading log...", "No changes recorded for the selected filters."

### Painel de detalhe

- Cabeçalho **escuro** (ícone quadrado arredondado na cor da marca + "Record detail" + `#id`),
  com dois botões: alternar JSON enxuto/completo e copiar JSON.
- Corpo **branco**, com linhas em grid de 2 colunas (rótulo cinza 120px + valor
  em negrito): Date/time, User (`DOMINIO\usuario`), Machine, Action, Area,
  Entity, Entity ID, Description, e Status só quando for erro.
- Depois, título `DETAILS` em maiúsculas espaçadas, e o JSON num bloco de
  **fundo claro** (`#fbfbfc`), borda cinza, cantos arredondados, fonte
  monoespaçada 11.5px, `white-space: pre-wrap`, texto selecionável.

---

## 5. FORMATO DO JSON — ENXUTO POR PADRÃO

O erro que quero evitar: mostrar o registro inteiro (request, result, before,
after) e afogar a informação. **Por padrão mostre só o alvo e o que mudou:**

```json
{
  "target": "Tooling Item #46",
  "changes": {
    "customer": { "oldValue": "", "newValue": "TESTE" },
    "comments": {
      "oldValue": "1 comment(s)",
      "newValue": "2 comment(s)",
      "added": [{ "date": "19/08", "text": "Produced, 10 --> 20", "system": true }]
    }
  }
}
```

- Quando o evento **não tem campos alterados** (export, import, sessão), troque
  `changes` por um `info` curto com os argumentos relevantes.
- Se houve erro, acrescente `error`.
- O botão de alternância mostra o **registro completo** (todos os campos da
  tabela + `details` inteiro), para auditoria profunda.
- O "Export JSON" sempre exporta o registro completo.
- Colorização de sintaxe feita **à mão**, com uma regex que envolve
  chave/string/número/booleano/null em `<span>` de classes distintas — em tons
  claros, porque o fundo é branco. Escape o HTML antes de colorir.

---

## 6. DETALHE DE SCROLL QUE EU QUERO CERTO DESDE O INÍCIO

Não use `position: sticky` no `<thead>`. Com sticky o cabeçalho fica no lugar,
mas **a barra de rolagem percorre a altura toda, inclusive ao lado do
cabeçalho** — fica feio e foi exatamente o que tive que refazer.

Faça assim:

- **Duas tabelas**: uma só com `<thead>` num container que não rola, outra só
  com `<tbody>` dentro do container com `overflow: auto`.
- **`<colgroup>` idêntico nas duas** para as colunas alinharem. (Se alguma
  coluna aparece/some dinamicamente, o `<col>` correspondente tem que entrar e
  sair junto com as células — a associação célula→coluna é por ordem.)
- **Compense a barra de rolagem**: meça em runtime
  (`el.offsetWidth - el.clientWidth`), guarde numa CSS custom property e aplique
  como `padding-right` no container do cabeçalho. Sem isso as colunas
  desalinham exatamente pela largura da barra quando a lista passa a rolar.
  Recalcule ao renderizar e ao redimensionar a janela.
- **Rolagem horizontal**: dê `min-width` à tabela para as colunas não colapsarem
  em telas estreitas e sincronize `scrollLeft` do cabeçalho com o do corpo.

O card inteiro deve usar **toda a altura disponível** (cadeia de
`display: flex` + `flex: 1` + `min-height: 0` até o container de scroll), com a
paginação ancorada embaixo.

---

## 7. COMPORTAMENTO DA UI

- A aba carrega **sob demanda** (só na primeira vez que é aberta).
- Busca com **debounce de ~300ms**; trocar qualquer filtro volta para a página 1.
- Ao chegar o push `audit-log-appended`: se a aba estiver visível, recarrega;
  se não, marca como "suja" e recarrega quando o usuário voltar nela.
- "Clear" pede confirmação e deixa explícito se vai apagar **tudo** ou **só o
  que está filtrado**.
- Copiar JSON e exportar mostram toast de sucesso/erro.

---

## 8. IDENTIFICAÇÃO DO USUÁRIO NA JANELA

Na barra de título, à esquerda, na mesma linha dos botões de minimizar/
maximizar/fechar: um ícone de usuário na cor da marca + o nome do usuário em
maiúsculas, negrito, 12px, **sem caixa/borda ao redor**. Tooltip com
`DOMINIO\usuario` e o nome da máquina.

---

## 9. CRITÉRIOS DE ACEITE

1. Alterar um registro em qualquer módulo gera **uma** entrada, com os campos alterados.
2. Salvar sem mudar nada **não** gera entrada.
3. Ações de leitura não geram entrada.
4. Erro na operação gera entrada com `status = error` **e o erro continua sendo propagado** normalmente para a UI.
5. Anexos registram o **nome do arquivo**; imagens em base64 nunca vão inteiras para o banco.
6. Falha ao gravar o log **nunca** quebra a operação de negócio.
7. A barra de rolagem da tabela começa **abaixo** do cabeçalho, e as colunas do cabeçalho e do corpo ficam alinhadas com e sem rolagem.
8. O JSON exibido por padrão cabe na tela sem rolar em uma alteração típica de 1–3 campos.
