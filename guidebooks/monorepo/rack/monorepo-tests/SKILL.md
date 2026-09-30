---
name: monorepo-tests
description: Como testar uma mudança num monorepo sem rodar o repositório inteiro
roles: [climber, belayer, reproducer]
when:
  files: ["packages/**", "apps/**", "libs/**", "modules/**"]
---

- Rode os testes do pacote que você mudou, não os da raiz: a anchor faz o mesmo (`{packages}` vira os pacotes que o pitch tocou). Veja o comando na tarefa.
- Um pacote do workspace importado pelo nome (`require("meu-pacote")`) resolve para a cópia do seu worktree: o que você muda é o que os testes carregam.
- Mudou um pacote de que outros dependem? Rode também os testes dos que o usam e diga nas notas do SAFE quais rodou.
- Se o pacote tem build (dist, lib) que outros consomem, confira como o projeto o gera antes de mudar a fonte; não edite a saída do build.
- Teste novo fica no lugar e na forma dos testes que o pacote já tem.
