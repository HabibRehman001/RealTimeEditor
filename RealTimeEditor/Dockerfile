FROM node:20-alpine as frontend-builder


COPY ./frontend /app

WORKDIR /app


RUN npm install
RUN npm run build 


CMD ["node" , "server.js"]

#Backend build

FROM node:20-alpine as backend-builder
COPY ./backend /app

WORKDIR /app

RUN npm install

COPY --from=frontend-builder /app/dist /app/dist

CMD ["node" , "server.js"]