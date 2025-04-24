const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const app = express();
const port = process.env.PORT || 8080;

// Constantes do servidor
const maxEngines = process.env.MAX_ENGINES || 4;
const defaultDepth = process.env.DEFAULT_DEPTH || 30; // Profundidade de análise
const defaultMultiPv = process.env.DEFAULT_MULTI_PV || 1;
const maxTimeLimit = process.env.MAX_TIME_LIMIT || 30000;
const stockfishPath = process.env.STOCKFISH_PATH || '/usr/local/bin/stockfish';

// Configurações do Stockfish
const DEFAULT_DEPTH = process.env.DEFAULT_DEPTH ? parseInt(process.env.DEFAULT_DEPTH) : 30;
const MAX_DEPTH = 35; // Profundidade máxima
const DEFAULT_THREADS = process.env.STOCKFISH_THREADS ? parseInt(process.env.STOCKFISH_THREADS) : 4;
const HASH_SIZE = process.env.STOCKFISH_HASH ? parseInt(process.env.STOCKFISH_HASH) : 1024;

// Configurações para comportamento mais humano
const HUMAN_SIMULATION = {
  // Configurações por nível de habilidade
  skillLevels: {
    // Nível muito fácil (1-8)
    beginner: {
      minDepth: 8,
      maxDepth: 12,
      skillLevel: 8,
      errorRate: 0.35, // 35% de chance de erro
      minTime: 800,
      maxTime: 2000,
    },
    // Nível médio (9-15)
    intermediate: {
      minDepth: 15,
      maxDepth: 20,
      skillLevel: 14,
      errorRate: 0.15, // 15% de chance de erro
      minTime: 1500,
      maxTime: 4000,
    },
    // Nível difícil (16-22)
    advanced: {
      minDepth: 20,
      maxDepth: 25,
      skillLevel: 20,
      errorRate: 0.05, // 5% de chance de erro
      minTime: 2000,
      maxTime: 5000,
    },
    // Nível muito difícil (23-28)
    expert: {
      minDepth: 25,
      maxDepth: 30,
      skillLevel: 25,
      errorRate: 0.01, // 1% de chance de erro
      minTime: 3000,
      maxTime: 6000,
    },
    // Nível impossível (29-30)
    master: {
      minDepth: 30,
      maxDepth: 35,
      skillLevel: 30,
      errorRate: 0.0, // Sem erros
      minTime: 3500,
      maxTime: 7000,
    }
  },
  
  // Obter configuração para um nível de habilidade
  getConfigForSkill: function(skillLevel) {
    if (skillLevel <= 8) {
      return this.skillLevels.beginner;
    } else if (skillLevel <= 15) {
      return this.skillLevels.intermediate;
    } else if (skillLevel <= 22) {
      return this.skillLevels.advanced;
    } else if (skillLevel <= 28) {
      return this.skillLevels.expert;
    } else {
      return this.skillLevels.master;
    }
  },
  
  // Determinar se deve cometer um erro
  shouldMakeError: function(skillLevel) {
    const config = this.getConfigForSkill(skillLevel);
    return Math.random() < config.errorRate;
  },
  
  // Simular tempo de pensamento humano
  getThinkingTime: function(skillLevel, positionComplexity = 0.5) {
    const config = this.getConfigForSkill(skillLevel);
    
    // Base time + random variation
    const baseTime = config.minTime;
    const maxVariation = config.maxTime - config.minTime;
    
    // Complexity factor (0.7-1.3)
    const complexityFactor = 0.7 + (positionComplexity * 0.6);
    
    // Calculate thinking time
    return Math.floor((baseTime + (Math.random() * maxVariation)) * complexityFactor);
  }
};

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
    engine.stdin.write(`setoption name Hash value ${process.env.STOCKFISH_HASH || 1024}\n`);
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

// Estimativa da complexidade da posição (0-1)
function estimatePositionComplexity(fen) {
  try {
    // Parsing básico da FEN para contar peças
    const piecePlacement = fen.split(' ')[0];
    const pieces = piecePlacement.replace(/\d+/g, match => ' '.repeat(parseInt(match))).replace(/\//g, '');
    
    // Contar peças
    const pieceCount = pieces.trim().length;
    
    // Contagem de tipos de peças
    const uniquePieces = new Set(pieces.split(''));
    const uniquePieceCount = uniquePieces.size;
    
    // Posição mais complexa tem muitas peças diferentes
    const complexity = Math.min(1, (pieceCount / 32) * 0.7 + (uniquePieceCount / 12) * 0.3);
    
    return complexity;
  } catch (e) {
    console.error('Erro ao estimar complexidade:', e);
    return 0.5; // Valor médio em caso de erro
  }
}

// Função para selecionar um movimento sub-ótimo (para simular erro humano)
function selectSuboptimalMove(bestMove, analysis, skillLevel) {
  if (!analysis || analysis.length <= 1) {
    return bestMove;
  }
  
  // Para níveis de habilidade mais baixos, considerar movimentos piores
  const config = HUMAN_SIMULATION.getConfigForSkill(skillLevel);
  
  // Movimentos alternativos do MultiPV
  const alternativeMoves = analysis.slice(1);
  
  // Quanto menor o skillLevel, maior a chance de escolher movimentos piores
  const randomIndex = Math.floor(Math.random() * Math.min(alternativeMoves.length, Math.max(2, Math.floor(20 / skillLevel))));
  
  // Escolher um movimento alternativo
  if (alternativeMoves[randomIndex] && alternativeMoves[randomIndex].pv && alternativeMoves[randomIndex].pv.length > 0) {
    console.log(`Simulando erro humano: escolhendo movimento alternativo (${randomIndex + 1}) em vez do melhor movimento`);
    return { move: alternativeMoves[randomIndex].pv[0], ponder: alternativeMoves[randomIndex].pv[1] || null };
  }
  
  return bestMove;
}

// Rota para obter o melhor movimento
app.post('/api/bestmove', async (req, res) => {
  try {
    const { fen, depth = defaultDepth, multiPv = defaultMultiPv, timeLimit, skillLevel = 20 } = req.body;
    
    // Validar entrada
    if (!fen) {
      return res.status(400).json({ error: 'Posição FEN é obrigatória' });
    }
    
    // Configuração baseada no nível de habilidade humano
    const humanConfig = HUMAN_SIMULATION.getConfigForSkill(skillLevel);
    
    // Validar limites
    const actualDepth = Math.min(Math.max(humanConfig.minDepth, parseInt(depth)), humanConfig.maxDepth);
    const actualMultiPv = Math.min(Math.max(3, parseInt(multiPv)), 5); // Sempre usar MultiPV para ter alternativas
    
    // Calcular tempo baseado na complexidade da posição e nível de habilidade
    const positionComplexity = estimatePositionComplexity(fen);
    const thinkingTime = HUMAN_SIMULATION.getThinkingTime(skillLevel, positionComplexity);
    const actualTimeLimit = timeLimit ? Math.min(parseInt(timeLimit), maxTimeLimit) : thinkingTime;
    
    console.log(`Calculando movimento para nível ${skillLevel}, profundidade ${actualDepth}, MultiPV ${actualMultiPv}, tempo ${actualTimeLimit}ms`);
    
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
    
    // Configurar o motor para o nível de habilidade apropriado
    engineInstance.engine.stdin.write(`setoption name Skill Level value ${humanConfig.skillLevel}\n`);
    engineInstance.engine.stdin.write(`setoption name UCI_LimitStrength value ${skillLevel < 30 ? 'true' : 'false'}\n`);
    
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
    
    // Verificar se devemos simular um erro humano
    if (HUMAN_SIMULATION.shouldMakeError(skillLevel) && result.analysis && result.analysis.length > 1) {
      const suboptimalMove = selectSuboptimalMove(result.bestMove, result.analysis, skillLevel);
      result.bestMove = suboptimalMove;
      result.isHumanError = true;
    }
    
    // Adicionar informações sobre o comportamento humano simulado
    result.humanSimulation = {
      skillLevel,
      thinkingTime: actualTimeLimit,
      positionComplexity,
      errorRate: humanConfig.errorRate
    };
    
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