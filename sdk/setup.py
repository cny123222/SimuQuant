from setuptools import setup, find_packages

setup(
    name="simquant",
    version="0.1.0",
    description="SimuQuant market simulation Python SDK",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        "httpx>=0.27.0",
        "websockets>=12.0",
    ],
)
