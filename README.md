# ☕ Café da Manhã — 9006 Suites & Reserva Madero

Relação diária do café da manhã para o restaurante, separada por empreendimento,
com sugestão de pedido à padaria de acordo com a ocupação.

**Abrir o sistema:** https://cafe-da-manha-iota.vercel.app/ (Vercel)
— cópia também em https://9006suites2026.github.io/cafe-da-manha/ (GitHub Pages).
Cada envio para a branch `main` atualiza os dois sozinhos.

## Como funciona

- **Reservas:** cadastro de apto, hóspede, adultos, crianças, check-in e check-out
  (ou colar várias linhas do Excel). Reservas a partir de 24/11 já vêm com café incluso.
- **Relação do dia:** mostra, para amanhã (ou qualquer dia), quantas pessoas tomam café
  em cada empreendimento, a lista de aptos, os extras do dia e a previsão de 7 dias.
- **Pedido à padaria:** quantidades calculadas por pessoa + margem de segurança.
  Botões para copiar no WhatsApp e imprimir.

Regra: o hóspede toma café da manhã seguinte ao check-in até a manhã do check-out.

## Banco de dados (Supabase)

Sem configuração, a página funciona no **modo local** (dados só no navegador daquele PC).
Para recepção e restaurante verem os mesmos dados:

1. Crie um projeto no [Supabase](https://supabase.com) (região São Paulo).
2. Rode `supabase-banco.sql` no **SQL Editor**.
3. Em **Authentication → Sign In / Providers**, desligue *Allow new users to sign up*.
4. Em **Authentication → Users**, crie os usuários da recepção e do restaurante.
5. Copie a *Project URL* e a chave *Publishable* para `SUPABASE_URL` e `SUPABASE_KEY`
   no início do `<script>` do `index.html`.

A chave publishable pode ficar no código público: os dados só são acessíveis com login
(Row Level Security). **Nunca** coloque a chave `secret` / `service_role` aqui.
Nenhum dado de hóspede fica neste repositório.
