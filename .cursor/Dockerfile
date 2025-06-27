FROM ubuntu

# Install Python 3.11
RUN apt-get update && apt-get install -y \
    software-properties-common \
    curl \
    git \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y \
    python3.11 \
    python3.11-dev \
    python3.11-distutils \
    python3.11-venv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install pip for Python 3.11
RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11

# Set Python 3.11 as the default python3
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

# Pre-install spaCy globally to speed up virtual environment setup
RUN pip3 install spacy && python3 -m spacy download en_core_web_sm

# Install Node.js 20 using nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash \
    && source ~/.bashrc \
    && nvm install 20 \
    && nvm use 20 \
    && nvm alias default 20
    
# Verify installation
RUN python3 --version && pip3 --version \
    && source ~/.bashrc && nvm use 20 && node --version && npm --version

# Set environment variable for virtual environment path
ENV PATH="/workspace/venv/bin:$PATH"
