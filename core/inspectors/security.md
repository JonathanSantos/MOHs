---
name: security
description: Segurança do diff, com foco no que vira brecha em produção
when:
  files: ["**/{server,api,routes,auth,middleware,db}/**", "**/*.{env,sql}", "**/package.json"]
---

Procure, no diff:

- Entrada não validada chegando em consulta, comando, caminho de arquivo ou HTML.
- Segredo, token ou credencial no código, em log ou em resposta de API.
- Autorização ausente em rota ou ação nova.
- Tokens, ids públicos ou senhas gerados sem fonte criptográfica.
- Dados pessoais expostos além do necessário.
- Dependência nova sem necessidade clara.

Severidade: critical quando explorável sem autenticação; high quando explorável com pouco esforço; medium quando depende de outra falha; low para endurecimento.
