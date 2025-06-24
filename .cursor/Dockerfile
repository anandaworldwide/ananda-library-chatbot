#+++++++++++++++++++++
# Use Ubuntu as the base
#+++++++++++++++++++++
FROM ubuntu:22.04

# Change the default shell to bash
SHELL ["/bin/bash", "-c"]
#---------------------

#+++++++++++++++++++++
# Set environment variables to non-interactive
#+++++++++++++++++++++
ENV DEBIAN_FRONTEND=noninteractive
#---------------------

#+++++++++++++++++++++
# Install en_US.utf8 locale
#+++++++++++++++++++++
RUN apt-get update && apt-get install -y locales && rm -rf /var/lib/apt/lists/* \
    && localedef -i en_US -c -f UTF-8 -A /usr/share/locale/locale.alias en_US.UTF-8
ENV LANG=en_US.utf8
#---------------------

#+++++++++++++++++++++
# Install system packages
#+++++++++++++++++++++
RUN apt-get update && apt-get install -y \
    sudo \
    software-properties-common \
    curl \
    wget \
    git \
    build-essential \
    emacs \
    && rm -rf /var/lib/apt/lists/*
#---------------------

#+++++++++++++++++++++
# Install Python 3.11
#+++++++++++++++++++++
# Add deadsnakes PPA for Python 3.11
RUN add-apt-repository ppa:deadsnakes/ppa && \
    apt-get update && \
    apt-get install -y \
    python3.11 \
    python3.11-dev \
    python3.11-venv \
    python3.11-distutils \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Make python3.11 the default python3 and python
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

# Upgrade pip for Python 3.11 specifically
RUN python3.11 -m pip install --upgrade pip
#---------------------

#+++++++++++++++++++++
# Create non-root user with sudo privileges
#+++++++++++++++++++++
RUN useradd -m -s /bin/bash ubuntu && \
    usermod -aG sudo ubuntu && \
    echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

USER ubuntu
#---------------------

#+++++++++++++++++++++
# Set working directory and default command
#+++++++++++++++++++++
WORKDIR /home/ubuntu

CMD ["/bin/bash"]
#---------------------
