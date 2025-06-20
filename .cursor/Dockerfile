FROM ubuntu:24.04

# Install Python 3.11 and Node.js dependencies
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    python3-pip \
    nodejs \
    npm \
    libpq-dev \
    build-essential \
    libxml2-dev \
    libxslt1-dev \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.11 as the default python3
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# Install latest Node.js LTS (Ubuntu's nodejs package is often outdated)
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs

# Create a non-root user (optional, but recommended)
RUN useradd -m -u 1000 ubuntu
USER ubuntu
WORKDIR /home/ubuntu

# The agent will handle cloning the repo and running the install command