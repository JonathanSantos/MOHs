---
name: architecture
description: Coerência do diff com a estrutura e os padrões do projeto
when:
  files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"]
tests: true
---

Compare o diff com o survey, os bolts e o beta:

- Código novo no lugar certo da estrutura existente.
- Nenhuma duplicação de algo que o projeto já tem.
- Dependências entre camadas na direção certa.
- Interfaces públicas iguais aos bolts.
- Nada de abstração nova sem uso real.
- Testes seguindo os padrões do projeto, sem repetir preparação que poderia ser um helper.

Severidade: high quando quebra um contrato ou cria acoplamento difícil de desfazer; medium para desvio de padrão; low para sugestões.
