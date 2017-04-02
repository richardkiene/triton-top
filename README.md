# triton-top

## Toy app for showing a top like interface for a given Triton user

__WARNING__ Not fully supported and will eventually be moved into node-triton

![Running App](https://us-east.manta.joyent.com/shmeeny/public/ttop_latest.png)

```
[user@box ~/code/triton-top]# node index.js
usage: node index.js [OPTIONS]
options:
    --version                         Print tool version and exit.
    -h, --help                        Print this help and exit.
    -c CERT, --cert=CERT              cert file path.
    -e ENDPOINT, --endpoint=ENDPOINT  Container Monitor endpoint to pull from.
    -k KEY, --key=KEY                 key file path.
    --cpus=CPUS                       optional number of CPUs to assume.
```

```
[root@dev01 ~/code/triton-top]# node --abort-on-uncaught-exception index.js \
-e cmon.coal.joyent.us -c cert.pem -k key.pem --cpus=4
```
