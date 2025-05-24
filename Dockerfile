FROM alpine:3.18 as builder

# Instalar dependências de compilação
RUN apk add --no-cache git g++ make curl

# Definir variáveis para compilação otimizada
ENV STOCKFISH_VERSION=16
ENV ARCH=x86-64-modern

# Obter código fonte do Stockfish
WORKDIR /build
RUN git clone --branch "sf_${STOCKFISH_VERSION}" --depth 1 https://github.com/official-stockfish/Stockfish.git .

# Compilar com otimizações avançadas
WORKDIR /build/src
RUN make build ARCH=$ARCH \
    COMP=gcc \
    EXTRALDFLAGS="-static-libgcc -static-libstdc++" \
    EXTRACXXFLAGS="-march=x86-64 -mtune=generic -O3 -flto" \
    -j$(nproc) && \
    strip stockfish

# Imagem final
FROM node:18-alpine

# Instalar dependências mínimas
RUN apk add --no-cache tzdata

# Configurar diretório de trabalho
WORKDIR /app

# Copiar binário do Stockfish
COPY --from=builder /build/src/stockfish /usr/local/bin/stockfish
RUN chmod +x /usr/local/bin/stockfish

# Configurar variáveis de ambiente
ENV PORT=8080
ENV STOCKFISH_PATH=/usr/local/bin/stockfish
ENV STOCKFISH_THREADS=4
ENV STOCKFISH_HASH=512
ENV DEFAULT_DEPTH=25
ENV DEFAULT_MULTI_PV=1
ENV MAX_TIME_LIMIT=30000
ENV MAX_ENGINES=4
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

# Copiar arquivos da aplicação
COPY package*.json ./
RUN npm install --production
COPY . .

# Verificar se o Stockfish está funcionando
RUN echo "isready" | stockfish | grep "readyok"

# Configurar HealthCheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:$PORT/health || exit 1

# Expor porta
EXPOSE $PORT

# Iniciar aplicação
CMD ["node", "server.js"] 