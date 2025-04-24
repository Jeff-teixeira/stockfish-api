FROM node:16-alpine

# Instalar dependências necessárias para compilar o Stockfish
RUN apk add --no-cache g++ make git

# Clonar e compilar o Stockfish
WORKDIR /app
RUN git clone --depth 1 https://github.com/official-stockfish/Stockfish.git
WORKDIR /app/Stockfish/src
RUN make -j build ARCH=x86-64-modern

# Configurar o servidor Node.js para expor o Stockfish como API
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Expor a porta para a API
EXPOSE 8080

# Iniciar o servidor
CMD ["node", "server.js"]