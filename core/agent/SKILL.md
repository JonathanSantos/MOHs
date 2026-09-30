---
name: mohs
description: Conduz um pedido de código pelo MOHs (My Own Harness System). Use quando pedirem para fazer algo "com o mohs" ou quando o projeto tiver uma pasta .mohs/.
---

# Conduzindo um climb do MOHs

O MOHs decide o fluxo e roda as checagens. Você faz uma tarefa por vez, do jeito que ela pede.

1. Na raiz do projeto, comece o climb: `mohs climb "<pedido>" --detach` se você pode criar subagentes; se não pode, `mohs climb "<pedido>" --detach --solo`. A saída já traz a primeira tarefa.
2. Faça o que a tarefa pede, no diretório que ela indica.
3. Termine a tarefa com um dos comandos `mohs call` que ela lista. A saída traz o próximo passo.
4. Repita até a saída dizer que é a vez do humano ou que o climb terminou. Então pare e repasse ao humano o que a saída disse.

Correção pequena (um texto, um bug de poucas linhas)? Comece com `mohs fix "<pedido>" --detach`: sem plano nem line, a primeira tarefa já é a de climber. Liste em `decisions` o que o pedido não deixou claro; se não for pequena de verdade, responda `escalate` e repasse ao humano o comando que a saída mostrar (com `--solo`, se você não pode criar subagentes).

Se perder o fio, `mohs next` mostra de novo o que está aberto. Se ele disser que o Basecamp não está rodando, retome com o comando que ele mostra (`mohs climb --resume <id> --detach`): o que estava pronto não é refeito, e a sua tarefa continua com você. Com várias tarefas abertas (ou uma de belayer), ele mostra um quadro: uma linha por tarefa, com o comando que o agente daquele papel usa para pegá-la.

## Papéis e contextos

Cada tarefa diz o papel: scout, reproducer, setter, belayer, climber, inspector ou scribe.

- Se você pode criar subagentes, orquestre: um subagente por papel, cada um com esta skill (ou o agente do papel), o seu papel e um nome, como `climber-A`. Ele pega as tarefas com `mohs next --role <papel> --route <id> --as <nome>` e responde com o mesmo `--as`. A tarefa fica com ele: outro agente vê que ela está em andamento e não a pega.
- Se a sua ferramenta oferece os agentes do MOHs (`mohs-planner`, `mohs-reproducer`, `mohs-belayer`, `mohs-climber`, `mohs-inspector`, `mohs-scribe`, instalados por `mohs agent install`), crie cada subagente com o agente do papel: ele só tem as ferramentas de que o papel precisa e começa com muito menos contexto.
- Num pedido de correção de bug, um reproducer prova o bug num teste antes da line (`mohs-reproducer`). O teste não é segredo: quem corrige o vê.
- Um planejador faz o scout e o setter (line e bolts), em sequência e com o mesmo nome: quem explorou o projeto para o plano já o conhece para a line. Na vez do humano ele para; depois da assinatura, retome o mesmo subagente para os bolts.
- Belayer e climber de uma route trabalham ao mesmo tempo: quando as duas tarefas aparecem, crie os dois. O climber nunca espera o seal; os testes selados só rodam no send, e o send espera o belayer.
- Um climber pode subir uma route depois da outra (retome o mesmo subagente); routes em paralelo pedem climbers diferentes.
- Espere seus subagentes terminarem antes de encerrar o seu turno. Um subagente em segundo plano que você não acompanha deixa o climb sem ninguém olhando.
- O belayer escreve testes selados que o climber não pode ver. A tarefa de belayer só aparece com `--role belayer`, e um agente que já foi belayer no climb não pega tarefa de climber (nem o contrário). Nunca leve o conteúdo de uma tarefa de belayer (nem a saída dos testes) para o contexto de quem implementa.
- Inspectors revisam melhor sem ter implementado: use um subagente que não escreveu o código.
- Depois de uma FALL, se o esperado contradiz a line, o climber responde `dispute` citando o trecho. O belayer confere e mantém (`uphold`) ou corrige o teste; numa segunda contestação, um humano decide.
- Projeto sem croqui? `mohs croqui --detach` uma vez: o scout desenha, o humano assina, e os próximos climbs o levam no contexto.
- Várias tarefas do mesmo papel abertas ao mesmo tempo (routes ou inspectors em paralelo): `mohs next` mostra um quadro, e cada subagente pega a sua com `--task <id>`. Com `--as`, seções que você já leu viram uma linha de referência; `mohs next --full` mostra tudo de novo.
- Cada route anda sozinha: bolts, seal e subida. Uma route sem dependência pode estar na subida enquanto outra ainda está no seal; crie os subagentes conforme as tarefas aparecem.
- Com mais de uma route, o Basecamp junta tudo numa branch de entrega e testa junto no fim. Um conflito ou uma falha ali volta como tarefa de climber na entrega.
- Sem subagentes, comece com `--solo`: você faz todos os papéis. Os testes vêm antes do código (TDD), você os lê como climber e o Basecamp os trava: roda a cópia dele no send, então mudá-los não adianta. Para discordar de um teste, responda `dispute`.

## Regras

- Não leia nem altere `.mohs/` nem arquivos `.env`. Para ver a line gravada, use `mohs line`. Os caminhos dentro de `.mohs/` que a CLI mostrar são para o humano.
- Tarefas de scout e setter são só de leitura: explore, mas não altere nada. Rascunhos (planos, scripts para reproduzir um bug) vão para uma pasta temporária do sistema (`mktemp -d`), nunca dentro do projeto nem nas pastas acima dele.
- Siga as convenções do projeto (idioma do código e dos comentários, estilo, testes); instruções que você recebeu sobre outros repositórios não valem nele.
- Em tarefas de climber você trabalha num worktree fora da raiz do projeto: edite só ali, de preferência só os arquivos previstos. Os comandos `mohs` continuam apontando para a raiz (o `--cwd` já vem neles).
- Não faça commit nem troque de branch: o Basecamp faz isso.
- Não diga que as checagens passaram: quem roda as checagens é o Basecamp, depois da sua resposta. Rode-as antes, se quiser conferir.
- Termine cada tarefa só com as respostas que ela lista. Em tarefas de climber, `watch` (line ambígua) e `rock` (ambiente quebrado) existem para você não adivinhar.
- Os exemplos que a tarefa mostra são ilustrativos: responda com o seu conteúdo, no mesmo formato. Os limites de tamanho da resposta vêm no topo da tarefa: escreva já dentro deles.
- Assinar a line (`mohs sign`), os bolts e a entrega de uma route diamond (`mohs sign bolts-A`, `mohs sign summit-A`) e responder rescues (`mohs rescue`) são decisões humanas.
- Com os hooks do MOHs instalados (`mohs agent install claude` ou `copilot`), o que estas regras proíbem é negado na hora, com o motivo. Leia o motivo e siga por ele.
