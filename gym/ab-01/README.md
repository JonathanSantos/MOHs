# Gym · A/B 01

Primeiro A/B do MOHs (29/09/2026). Quatro pedidos no projeto `template/`, cada um feito por um subagente Sonnet 5.5 em dois braços:

- **direto**: o agente recebe o pedido e faz a mudança com testes.
- **mohs**: o agente recebe a skill do MOHs (`core/agent/SKILL.md`) e conduz um climb com `--detach --auto-sign`.

Quem julga é a suíte escondida `tarefas-ab01` (18 testes, só o que os pedidos dizem), que nenhum braço vê. Ela fica fora do repositório, em `~/.mohs/validation/hidden/` (`npm run validate -- hidden list`), para nenhum agente que trabalhe aqui dentro a encontrar.

| Pedido     | Texto                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| concluir   | Permitir marcar uma tarefa como concluída: complete(id) na store, e list({ pending: true }) devolvendo só as pendentes.                                                                                                                                |
| renomear   | Permitir renomear uma tarefa: rename(id, title) na store, com as mesmas regras de título do add.                                                                                                                                                       |
| prioridade | Adicionar prioridade às tarefas: add(title, { priority }) aceita 'baixa', 'media' ou 'alta' (padrão 'media'); prioridade inválida é erro. list({ sort: 'priority' }) devolve da mais alta para a mais baixa, mantendo a ordem de criação entre iguais. |
| salvar     | Permitir salvar e restaurar a lista: store.toJSON() devolve um objeto serializável e createStore(data) recria a store a partir dele, com as mesmas tarefas e ids.                                                                                      |

## Resultado

Os dois braços passaram nos 18 testes. O MOHs usou 21% mais tokens (62,2 mil contra 51,4 mil por tarefa) e o dobro do tempo (67 s contra 33 s), e entregou as decisões na line, o working copy intacto e 27% mais testes. Dados em `results.json` e `usage.json`.

## Para repetir

1. Para cada pedido e braço, copie `template/` para `runs/<pedido>-<braço>`, com `git init` e um commit. No braço mohs, rode `mohs init` e commite o `.mohs/`.
2. Rode os subagentes com os prompts acima (o braço mohs recebe a skill e usa `--detach --auto-sign`).
3. Registre tokens, ferramentas e tempo de cada subagente com `node usage.mjs <run> <tokens> <ferramentas> <ms> <decisões> "<nota>"`.
4. `node eval.mjs` roda a suíte escondida e os testes do projeto em cada entrega e grava `results.json`.
