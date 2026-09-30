import { z } from "zod";

// Mensagens de validação chegam a pessoas e agentes que leem português: o zod fala português em todo o MOHs.
z.config(z.locales.pt());

export { z };
