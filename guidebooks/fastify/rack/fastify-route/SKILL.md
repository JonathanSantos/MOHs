---
name: fastify-route
description: Como criar rotas Fastify com schema, erros previsíveis e registro em plugin
roles: [climber]
when:
  files: ["**/server/**/*.ts", "**/routes/**/*.ts"]
---

- Cada grupo de rotas é um plugin registrado com `fastify.register`, no arquivo da própria rota.
- Toda rota declara `schema` para `params`, `querystring`, `body` e `response`. A validação é do Fastify, não manual.
- Erros esperados respondem com status e corpo `{ error: string }` consistentes; nunca vaze stack trace.
- Lógica de negócio fica fora do handler, em funções puras testáveis sem subir o servidor.
- Testes de rota usam `fastify.inject`, sem abrir porta.
- Rotas que expõem dados verificam autorização antes de ler qualquer coisa.
