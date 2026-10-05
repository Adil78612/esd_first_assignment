"""
Part B — Python gRPC client for the GenerationService.

Calls the gRPC SaveGeneration RPC directly (no browser, no HTTP).
Sets a deadline, and shows one successful and one failed request.
"""

import grpc
import generations_pb2 as pb
import generations_pb2_grpc as pb_grpc

TARGET = "localhost:50051"
DEADLINE_SECONDS = 2.0     # like a timeout: give up if the server is too slow


import uuid

def save(stub, gen_id, gtype, content):
    trace_id = str(uuid.uuid4())
    req = pb.SaveRequest(id=gen_id, type=gtype, content=content)
    metadata = [("trace-id", trace_id)]
    try:
        reply = stub.SaveGeneration(req, timeout=DEADLINE_SECONDS, metadata=metadata)
        print(f"OK   trace={trace_id} id={gen_id!r:8} created={reply.created}")
    except grpc.RpcError as e:
        print(f"FAIL trace={trace_id} id={gen_id!r:8} code={e.code().name}")


def main():
    # one channel + stub, reused for all calls
    channel = grpc.insecure_channel(TARGET)
    stub = pb_grpc.GenerationServiceStub(channel)

    print(f"calling gRPC {TARGET}  (deadline={DEADLINE_SECONDS}s)\n")

    # 1) success — valid save
    save(stub, "grpc-1", "quote", "saved via gRPC")

    # 2) success — same id again: idempotent, created=False (same shared db.js)
    save(stub, "grpc-1", "quote", "saved via gRPC")

    # 3) failure — invalid input: server returns gRPC INVALID_ARGUMENT
    save(stub, "", "banana", "")

    channel.close()


if __name__ == "__main__":
    main()