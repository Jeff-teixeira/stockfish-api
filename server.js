const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8080;

// Habilitar CORS para todas as origens
app.use(cors());
app.use(express.json());

// Mapa para armazenar instâncias do Stockfish
const engines = new Map();

// Rota para verificar status do servidor
app.get('/', (req, res) => {
  res.send({ status: 'ok', message: 'Stockfish API está funcionando!' });
});

// Rota para obter melhor movimento
app.post('/api/bestmove', async (req, res) => {
  const { fen, depth = 15, timeLimit = 1000, skillLevel = 20 } = req.body;
  
  if (!fen) {
    return res.status(400).json({ error: 'fen é obrigatório' });
  }
  
  try {
    // Criar uma nova instância do Stockfish para cada solicitação
    const stockfish = spawn('/app/Stockfish/src/stockfish');
    let output = '';
    let bestMove = null;
    
    // Configurar handlers para stdout
    stockfish.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      // Verificar se a saída contém o melhor movimento
      if (text.includes('bestmove')) {
        const match = text.match(/bestmove\s+(\S+)/);
        if (match && match[1]) {
          bestMove = match[1];
        }
      }
    });
    
    // Configurar timeout para garantir resposta
    const timeout = setTimeout(() => {
      stockfish.stdin.write('stop\n');
      if (!bestMove) {
        res.status(500).json({ error: 'Timeout ao calcular movimento' });
        stockfish.kill();
      }
    }, timeLimit + 1000);
    
    // Configurar UCI e posição
    stockfish.stdin.write('uci\n');
    stockfish.stdin.write(`setoption name Skill Level value ${skillLevel}\n`);
    stockfish.stdin.write('setoption name Threads value 4\n');
    stockfish.stdin.write(`position fen ${fen}\n`);
    
    // Usar movetime ou depth conforme especificado
    if (timeLimit > 0) {
      stockfish.stdin.write(`go movetime ${timeLimit}\n`);
    } else {
      stockfish.stdin.write(`go depth ${depth}\n`);
    }
    
    // Aguardar o melhor movimento
    const checkInterval = setInterval(() => {
      if (bestMove) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        res.json({ bestMove });
        stockfish.kill();
      }
    }, 100);
    
    // Configurar evento de fechamento
    stockfish.on('close', () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
      if (!res.headersSent) {
        if (bestMove) {
          res.json({ bestMove });
        } else {
          res.status(500).json({ error: 'Falha ao calcular movimento' });
        }
      }
    });
    
  } catch (error) {
    console.error('Erro ao processar solicitação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Stockfish API rodando na porta ${port}`);
});