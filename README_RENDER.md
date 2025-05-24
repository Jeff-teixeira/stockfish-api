# Stockfish API - Guia Rápido para Render.com

## 1. Pré-requisitos
- Node.js 16+
- Binário do Stockfish (adicione ao repositório ou use buildpack customizado)

## 2. Variáveis de Ambiente (Render.com)

Configure no painel do Render:

- `STOCKFISH_PATH=/app/stockfish/stockfish`  # Caminho do binário no deploy
- `MAX_ENGINES=2`                            # Máximo de instâncias do Stockfish
- `MAX_TIME_LIMIT=5000`                      # Tempo máximo de análise (ms)
- `STOCKFISH_THREADS=2`                      # Threads por engine
- `STOCKFISH_HASH=256`                       # Hash size (MB)

> Ajuste o caminho do binário conforme o local real no seu deploy!

## 3. Deploy do Binário Stockfish
- Inclua o binário na pasta `stockfish/` do projeto, ou use um buildpack que instale o Stockfish.
- Exemplo: `lib/stockfish-api-main/stockfish/stockfish`

## 4. Endpoints
- `POST /api/bestmove`  
  `{ fen: "FEN", depth, multiPv, timeLimit, skillLevel }`
- `GET /health`         
  Verifica se o binário está presente e engines estão rodando.

## 5. Dicas para Render.com
- O serviço pode entrar em sleep. Use pings periódicos do frontend para evitar cold start.
- Se aparecer erro de binário não encontrado, confira o caminho e permissões do arquivo.
- Logs do Render.com ajudam a debugar problemas de inicialização.

## 6. Teste Local
```bash
cd lib/stockfish-api-main
node server.js
curl http://localhost:8080/health
```

---

Dúvidas? Veja os logs do Render.com e ajuste as variáveis conforme necessário. 