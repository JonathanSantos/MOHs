# Validações do MOHs

Como medimos se o harness melhora o trabalho de um agente: o mesmo pedido, feito de vários jeitos (os **braços**), cada um por um subagente numa pasta isolada, e todos julgados pela mesma suíte escondida. Toda validação segue este protocolo, com a ferramenta `npm run validate` (`gym/validation/`).

## Onde fica

```
gym/templates/<nome>/                       # projetos de partida reutilizáveis (versionados)
~/.mohs/validation/hidden/<nome>/           # suítes escondidas, fora do repositório
.validation/                                # no .gitignore: só na máquina de quem roda
└─ botao-contador-acessivel-20260930-1415/  # 3 palavras-chave + data + hora e minuto
   ├─ README.md            # pedido, template, versões do MOHs e o que cada braço mede
   ├─ run.json
   ├─ template/            # a cópia do projeto de partida desta validação
   ├─ direto/  placebo/  mohs-fix/  mohs/   # um repositório git por braço
   ├─ _prompts/<braço>.md  # o prompt exato que cada subagente recebeu
   ├─ _mohs/               # cópia congelada do MOHs (e _mohs@<commit>/ para outras versões)
   ├─ _bin/mohs-<braço>    # o `mohs` de cada braço, com MOHS_HOME próprio
   ├─ _mohs-home/<braço>/  # worktrees e seals de cada braço
   ├─ _usage.json          # parcelas de uso de cada braço (somadas na avaliação)
   ├─ _decisions.json      # o que o humano decidiu em cada braço
   ├─ _relatos/<braço>.md  # o relato final de cada subagente
   ├─ _hidden/             # a suíte escondida, copiada só na avaliação
   ├─ results.json
   └─ index.html           # a página de comparação
```

Repetições ganham sufixo (`mohs-r2`, `mohs-r3`); um braço em outra versão do MOHs leva o commit no nome (`mohs@a4f285f`).

## Os braços

| Braço           | O que mede                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direto`        | a linha de base: o agente sozinho, sem harness nem instrução extra                                                                                       |
| `placebo`       | quanto do ganho vem só de instrução em texto (processo, papéis, listas de revisão), sem nenhum mecanismo                                                 |
| `mohs-fix`      | a trilha talc: uma tarefa de climber, checagens do harness e assinatura no fim                                                                           |
| `mohs`          | o harness como foi desenhado: scout, line, trilha escolhida e um subagente por papel                                                                     |
| `mohs-solo`     | o custo da orquestração e o valor do sigilo: `climb --solo`, um agente em todos os papéis, testes antes do código, visíveis e travados em vez de selados |
| `<braço>@<ref>` | o mesmo braço numa versão anterior do MOHs, para ver se uma mudança melhorou o harness                                                                   |

Padrão para pedidos pequenos (um botão, uma correção): `direto`, `placebo`, `mohs-fix`, `mohs` e `mohs-solo`. Para pedidos grandes: `direto`, `placebo`, `mohs` e `mohs-solo`. O placebo recebe cerca de dois terços do texto que o braço MOHs recebe (prompt e skill), todo ele processo. Os prompts ficam em `gym/validation/arms.ts`; mudar um prompt muda a comparação, então isso é registrado no commit.

## Passo a passo

1. **Pedido, template e suíte escondida.** Escolha (ou crie) o template em `gym/templates/`; se ele tem `package-lock.json`, o `new` instala as dependências em cada braço antes de qualquer um rodar, e a avaliação as liga à entrega de todos do mesmo jeito. Escreva a suíte de aceite escondida antes de qualquer braço rodar: só o que o pedido diz, com os casos de borda que ele implica. Guarde-a fora do repositório e **mostre-a ao usuário para aprovar**: é a intenção dele que ela mede.
   ```bash
   npm run validate -- hidden save <nome> <pasta>
   ```
   Os braços MOHs criam subagentes com os agentes por papel do repositório (`.claude/agents/mohs-*.md`, gravados por `npm run validate -- agents`). O Claude Code os carrega ao abrir a sessão: se foram gravados ou mudaram, rode a validação numa sessão nova.
2. **Criar a validação.**
   ```bash
   npm run validate -- new botao contador acessivel --request "<pedido>" --template <nome> [--arms direto,placebo,mohs-fix,mohs] [--reps 1]
   ```
3. **Rodar os braços.** Um subagente por braço, todos com o mesmo modelo, em paralelo, cada um recebendo exatamente `_prompts/<braço>.md`. Nos braços MOHs, quem orquestra faz o papel do humano (veja as regras). Registre o uso que a ferramenta Agent reportou, uma parcela por execução (as retomadas depois de uma resposta humana são parcelas novas), e as parcelas dos subagentes que o orquestrador criou, que ele lista no relato (com `--ms 0` e o tempo na nota: eles rodam dentro do tempo do orquestrador, e somá-lo contaria o relógio duas vezes). Com `--agent`, a ferramenta lê o uso do subagente do braço e de todos os que ele criou nas transcrições do Claude Code (`~/.claude/projects/…/subagents`), inclusive retomadas: é o jeito padrão, porque não depende de o orquestrador lembrar dos filhos. As parcelas à mão ficam para quando não há transcrição:
   ```bash
   npm run validate -- usage <validação> <braço> --agent <id do subagente do braço>
   npm run validate -- usage <validação> <braço> --tokens <n> --tools <n> --ms <n> [--note "…"]
   npm run validate -- decision <validação> <braço> "assinei a line sem editar"
   npm run validate -- relato <validação> <braço> --file <relato.md>
   ```
4. **Avaliar e comparar.**
   ```bash
   npm run validate -- eval <validação> --hidden <nome>
   npm run validate -- report <validação>
   ```
   Cada braço é julgado no que entregou: o working tree nos braços sem harness, a branch de entrega (ou a da route) nos braços MOHs. O `report` gera o `index.html` da validação, que é publicado para o usuário com as conclusões; os relatos viram achados de atrito do harness.

`npm run validate -- list` mostra as validações feitas; `npm run validate` sozinho mostra a ajuda.

## O gym de issues reais

Pedidos pequenos e bem especificados empatam: o agente sozinho já acerta. O harness precisa ser medido onde deveria ganhar: bugs e features em código que existe, com risco de regressão. `gym/issues/<id>.json` descreve uma issue real: o repositório, o commit de antes da correção (base), o da correção (referência), o pedido padronizado escrito a partir da issue, os arquivos de teste que viram a suíte escondida e o comando que os roda.

```bash
npm run validate -- issue list
npm run validate -- issue prepare <id>   # base com dependências e suíte conferida: falha na base, passa inteira na referência
npm run validate -- issue new <id> [--arms direto,mohs-solo,mohs] [--reps 3]
npm run validate -- eval <validação> --hidden <id>
```

Uma issue só entra no banco se a suíte falha na base e passa inteira na referência; o `prepare` recusa a que não mede nada. O padrão é direto, mohs-solo e mohs, com 3 repetições. Escolha correções cujo commit não muda dependências, e cujos testes rodam sem build (nos commits do React de 2025 em diante, os testes do plugin de hooks dependem do React Compiler compilado).

## Regras

- **Isolamento.** Cada subagente trabalha só na pasta do seu braço; nenhum lê outro braço, a suíte escondida ou os resultados. As suítes escondidas ficam fora do repositório, e o MOHs de cada braço tem `MOHS_HOME` próprio.
- **Humano sem vantagem.** Quem orquestra escreveu a suíte escondida, então não pode usar o que sabe dela. Nos braços MOHs, ele assina o que o harness mostrar **sem editar** o texto. Nas decisões da line, fica com a recomendada, a não ser que ela contrarie o texto do pedido: aí recusa, escolhendo a opção que segue o pedido ou escrevendo a resposta que o pedido sustenta (`mohs sign D1=B "D2=…"`). Responde rescues pela opção que um usuário escolheria lendo só o pedido e registra cada decisão com `decision`. Se precisar editar algo, isso vai para o relatório como interferência.
- **Uso completo.** O uso de um braço é a soma de todas as suas parcelas, incluindo os subagentes aninhados. Sem isso, o braço MOHs parece mais barato do que é.
- **MOHs congelado.** A validação usa a cópia em `_mohs/` (com as mudanças não commitadas do momento); mudar o repositório depois não muda uma validação em andamento.
- **Mesma régua.** Mesmo pedido, mesmo template, mesmo modelo e mesma suíte escondida para todos. Uma validação que muda qualquer um deles vira outra validação.
- **O que medir.** Aprovação na suíte escondida, testes do projeto, tamanho do diff, tokens, ferramentas, tempo de relógio, minutos humanos (esperas por assinatura e rescue), trilha e tarefas do climb, falls, contestações, grau de evidência, linhas da line e decisões expostas ao humano.
- **Uma rodada é indício, não prova.** Para comparar braços de verdade, pelo menos 3 repetições por braço (`--reps 3`), e o relatório diz quando a diferença cabe na variação entre repetições.
