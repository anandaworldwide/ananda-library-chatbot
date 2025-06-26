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

# Create workspace directory and set as working directory
WORKDIR /workspace

# Create virtual environment in /workspace/.venv
RUN python3 -m venv .venv

# Activate virtual environment and install spaCy model
RUN . .venv/bin/activate && pip install --upgrade pip && pip install spacy && python -m spacy download en_core_web_sm

# Create .env.ananda file
RUN touch .env.ananda
    
# Verify installation
RUN python3 --version && pip3 --version

ENV PATH="/workspace/.venv/bin:$PATH"