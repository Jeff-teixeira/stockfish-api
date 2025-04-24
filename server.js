const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const app = express();
const port = process.env.PORT || 8080;

// Constantes do servidor
const maxEngines = process.env.MAX_ENGINES || 4;
const defaultDepth = process.env.DEFAULT_DEPTH || 25; // Aumentado para maior força
const defaultMultiPv = process.env.DEFAULT_MULTI_PV || 1;
const maxTimeLimit = process.env.MAX_TIME_LIMIT || 30000;
const stockfishPath = process.env.STOCKFISH_PATH || './stockfish';

app.use(cors());
app.use(express.json());

// Pool de instâncias do Stockfish
const enginePool = [];
let currentEngineIndex = 0;

// Função para criar uma instância otimizada do Stockfish
function createStockfishInstance() {
  console.log('Criando nova instância do Stockfish...');
  
  try {
    const engine = spawn(stockfishPath);
    let isReady = false;
    let pendingResolve = null;
    
    // Configurar o motor para máxima força
    engine.stdin.write('uci\n');
    engine.stdin.write(`setoption name Threads value ${process.env.STOCKFISH_THREADS || 4}\n`);
    engine.stdin.write(`setoption name Hash value ${process.env.STOCKFISH_HASH || 512}\n`);
    engine.stdin.write('setoption name UCI_LimitStrength value false\n');
    engine.stdin.write('setoption name Skill Level value 20\n');
    engine.stdin.write('setoption name Use NNUE value true\n');
    engine.stdin.write(`setoption name MultiPV value ${defaultMultiPv}\n`);
    engine.stdin.write('setoption name Ponder value false\n');
    engine.stdin.write('ucinewgame\n');
    engine.stdin.write('isready\n');
    
    engine.stdout.on('data', (data) => {
      const output = data.toString();
      
      if (output.includes('readyok') && !isReady) {
        isReady = true;
        console.log('Instância do Stockfish inicializada e pronta');
        if (pendingResolve) {
          pendingResolve();
          pendingResolve = null;
        }
      }
    });
    
    engine.on('error', (err) => {
      console.error('Erro ao iniciar Stockfish:', err);
      if (pendingResolve) {
        pendingResolve();
        pendingResolve = null;
      }
    });
    
    engine.on('close', (code) => {
      console.log(`Instância do Stockfish fechada com código: ${code}`);
    });
    
    return {
      engine,
      isReady: () => new Promise(resolve => {
        if (isReady) {
          resolve();
        } else {
          pendingResolve = resolve;
        }
      }),
      busy: false
    };
  } catch (error) {
    console.error('Falha ao criar instância do Stockfish:', error);
    return null;
  }
}

// Inicializar o pool de motores
for (let i = 0; i < maxEngines; i++) {
  const instance = createStockfishInstance();
  if (instance) {
    enginePool.push(instance);
  }
}

// Rota para obter o melhor movimento
app.post('/api/bestmove', async (req, res) => {
  try {
    const { fen, depth = defaultDepth, multiPv = defaultMultiPv, timeLimit } = req.body;
    
    // Validar entrada
    if (!fen) {
      return res.status(400).json({ error: 'Posição FEN é obrigatória' });
    }
    
    // Validar limites
    const actualDepth = Math.min(Math.max(1, parseInt(depth)), 30);
    const actualMultiPv = Math.min(Math.max(1, parseInt(multiPv)), 5);
    const actualTimeLimit = timeLimit ? Math.min(parseInt(timeLimit), maxTimeLimit) : null;
    
    // Obter uma instância do engine
    let engineInstance = null;
    let engineIndex = -1;
    
    // Procurar uma instância disponível
    for (let i = 0; i < enginePool.length; i++) {
      const idx = (currentEngineIndex + i) % enginePool.length;
      if (!enginePool[idx].busy) {
        engineInstance = enginePool[idx];
        engineIndex = idx;
        currentEngineIndex = (idx + 1) % enginePool.length;
        break;
      }
    }
    
    // Se todas as instâncias estiverem ocupadas, usar a próxima com rodízio
    if (!engineInstance) {
      engineIndex = currentEngineIndex;
      engineInstance = enginePool[engineIndex];
      currentEngineIndex = (engineIndex + 1) % enginePool.length;
    }
    
    engineInstance.busy = true;
    
    // Garantir que o motor está pronto
    await engineInstance.isReady();
    
    // Obter o melhor movimento
    const result = await getBestMove(
      engineInstance.engine,
      fen,
      actualDepth,
      actualMultiPv,
      actualTimeLimit
    );
    
    // Liberar a instância
    engineInstance.busy = false;
    
    // Reiniciar o tabuleiro
    engineInstance.engine.stdin.write('ucinewgame\n');
    engineInstance.engine.stdin.write('isready\n');
    
    return res.json(result);
  } catch (error) {
    console.error('Erro ao processar requisição:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Função para obter o melhor movimento
function getBestMove(engine, fen, depth, multiPv, timeLimit) {
  return new Promise((resolve, reject) => {
    const output = [];
    let bestMove = null;
    let analysis = [];
    let timeout;
    
    // Configurar tempo limite
    if (timeLimit) {
      timeout = setTimeout(() => {
        engine.stdin.write('stop\n');
        console.log('Análise interrompida por tempo limite');
      }, timeLimit);
    }
    
    const dataHandler = (data) => {
      const text = data.toString();
      output.push(text);
      
      // Capturar análise multipv
      const multipvMatches = text.match(/info depth (\d+) seldepth \d+ multipv (\d+) score (cp|mate) ([-\d]+).*?pv (.+)/g);
      if (multipvMatches) {
        multipvMatches.forEach(line => {
          const [, currentDepth, pvNum, scoreType, scoreValue, pv] = 
            line.match(/info depth (\d+) seldepth \d+ multipv (\d+) score (cp|mate) ([-\d]+).*?pv (.+)/);
          
          const score = scoreType === 'cp' ? parseInt(scoreValue) / 100 : `mate ${scoreValue}`;
          const moves = pv.trim().split(' ');
          
          const analysisEntry = {
            depth: parseInt(currentDepth),
            multipv: parseInt(pvNum),
            score: {
              type: scoreType,
              value: parseInt(scoreValue),
              readable: score
            },
            pv: moves
          };
          
          // Atualizar ou adicionar entrada de análise
          const existingIndex = analysis.findIndex(a => a.multipv === parseInt(pvNum));
          if (existingIndex >= 0) {
            analysis[existingIndex] = analysisEntry;
          } else {
            analysis.push(analysisEntry);
          }
        });
      }
      
      // Capturar o melhor movimento
      const moveMatch = text.match(/bestmove (\w+)( ponder (\w+))?/);
      if (moveMatch) {
        bestMove = {
          move: moveMatch[1],
          ponder: moveMatch[3] || null
        };
        
        // Ordenar análise por multipv
        analysis.sort((a, b) => a.multipv - b.multipv);
        
        if (timeout) clearTimeout(timeout);
        
        engine.stdout.removeListener('data', dataHandler);
        resolve({
          bestMove,
          analysis,
          depth: analysis.length > 0 ? analysis[0].depth : depth
        });
      }
    };
    
    engine.stdout.on('data', dataHandler);
    
    // Configurar a posição e iniciar análise
    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write(`setoption name MultiPV value ${multiPv}\n`);
    
    if (timeLimit) {
      engine.stdin.write(`go depth ${depth} movetime ${timeLimit}\n`);
    } else {
      engine.stdin.write(`go depth ${depth}\n`);
    }
  });
}

// Rota de saúde para healthcheck
app.get('/health', (req, res) => {
  if (enginePool.length > 0) {
    res.status(200).json({ status: 'ok', engines: enginePool.length });
  } else {
    res.status(500).json({ status: 'error', message: 'Nenhuma instância do Stockfish disponível' });
  }
});

// Rota raiz
app.get('/', (req, res) => {
  res.json({
    name: 'Stockfish API',
    endpoints: [
      { path: '/api/bestmove', method: 'POST', description: 'Obter o melhor movimento para uma posição FEN' },
      { path: '/health', method: 'GET', description: 'Verificar saúde do serviço' }
    ]
  });
});

// Middleware para capturar rotas não encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado' });
});

// Encerramento gracioso
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('Encerrando servidor graciosamente...');
  
  // Encerrar todas as instâncias de Stockfish
  for (const engine of enginePool) {
    engine.engine.kill();
  }
  
  // Encerrar o servidor
  server.close(() => {
    console.log('Servidor encerrado');
    process.exit(0);
  });
}

const server = app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
  console.log(`Stockfish inicializado com ${enginePool.length} instâncias`);
}); 