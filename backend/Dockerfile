FROM node:20-alpine

WORKDIR /app

# Strumenti di build per bcrypt (modulo nativo): se non trova un binario
# precompilato per l'architettura dell'immagine lo compila con node-gyp.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY db/init/13_ticketmaster_sync_schema.sql ./db/init/13_ticketmaster_sync_schema.sql

EXPOSE 3000

CMD ["node", "src/server.js"]
