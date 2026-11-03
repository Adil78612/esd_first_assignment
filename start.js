// One process, two servers: HTTP on 3000, gRPC on 50051 (its metrics on 9091)
require('./app');
require('./grpc_server');