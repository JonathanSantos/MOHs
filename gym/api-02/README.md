# Gym · API 02

Segundo teste grande do MOHs (29/09/2026), repetido depois da fase 5.1 (dependências entre routes, branch de entrega, posse de tarefa). Um subagente orquestrador recebe a skill do MOHs (`core/agent/SKILL.md`) e conduz um climb no projeto `template/`, criando um subagente por papel e route. Quem faz o papel de humano assina a line e o que a dureza pedir.

Pedido:

> Transformar o projeto numa pequena API HTTP de tarefas.
>
> 1. Cada tarefa ganha prioridade: add(title, { priority }) aceita 'baixa', 'media' ou 'alta' (padrão 'media'); prioridade inválida é erro. A store ganha complete(id).
> 2. Persistência em arquivo: store.saveTo(caminho) grava um JSON, e createStore.loadFrom(caminho) recria a store com as mesmas tarefas e ids, sem colisão de ids depois.
> 3. Um servidor sem dependências em src/server.js: createServer(store) devolve um http.Server (do node:http) ainda sem escutar, com GET /tasks (lista; ?pending=true tira as concluídas), POST /tasks (corpo JSON {title, priority}; responde 201 com a tarefa criada), PATCH /tasks/:id/complete (204) e DELETE /tasks/:id (204, ou 404 se não existe). Erros de validação respondem 400 com {error}.

Quem julga é a suíte escondida `tarefas-api` (5 testes, só o que o pedido diz), que ninguém vê durante o climb. Ela fica fora do repositório, em `~/.mohs/validation/hidden/` (`npm run validate -- hidden list`).

## Resultado

| Rodada | MOHs | Suíte escondida                                | Duração | Tokens do orquestrador |
| ------ | ---- | ---------------------------------------------- | ------- | ---------------------- |
| 1      | 5.0  | 0/5 e 1/5 por branch; 5/5 só com merge manual  | 13 min  | ~105 mil               |
| 2      | 5.1  | 5/5 na branch de entrega, 0 conflitos, 0 falls | 60 min  | ~164 mil               |

O relatório visual da rodada 2 está em `index.html` (gerado com `mohs report --annex annex.html`).

## Para repetir

1. Copie `template/` para uma pasta nova, com `git init` e um commit, e rode `mohs init`.
2. Dê ao orquestrador a skill e o pedido acima e peça que rode `mohs climb --detach` e siga `mohs next` até o fim, criando um subagente por papel.
3. Quando o climb parar, faça o papel de humano: revise e rode `mohs sign` (line, bolts, summit).
4. Extraia a entrega (`git archive mohs/<climb>/entrega`), copie `api.test.js` da suíte `tarefas-api` para `acceptance/` e rode `node --test acceptance/api.test.js`.
5. `mohs report --annex annex.html` gera o relatório do climb.
