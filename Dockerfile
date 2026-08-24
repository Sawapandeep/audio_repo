FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deno.land/install.sh | sh
ENV PATH="/root/.deno/bin:${PATH}"
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY requirements.txt ./
RUN python3 -m pip install --break-system-packages -r requirements.txt
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
