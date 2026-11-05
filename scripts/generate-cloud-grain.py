"""Regenerate the seamless blue-noise rank tile used by the cloud shader (offline)."""

import math
import struct
import zlib
from pathlib import Path

SIDE = 128
COUNT = SIDE * SIDE
OUTPUT = Path(__file__).resolve().parents[1] / "app/assets/art/cloud-grain.png"


def initial_points():
    # A fixed shuffle makes the texture independent of the platform's random generator.
    order = list(range(COUNT))
    state = 0x1CA73F5D
    for i in range(COUNT - 1, 0, -1):
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        j = state % (i + 1)
        order[i], order[j] = order[j], order[i]
    return order[: COUNT // 8]


def make_ranks():
    occupied = bytearray(COUNT)
    energy = [0.0] * COUNT
    ranks = bytearray(COUNT)
    kernel = [
        (dx, dy, math.exp(-(dx * dx + dy * dy) / 4.5))
        for dy in range(-5, 6) for dx in range(-5, 6)
    ]

    def set_point(index, value):
        occupied[index] = value
        sign = 1 if value else -1
        y, x = divmod(index, SIDE)
        for dx, dy, weight in kernel:
            neighbor = ((y + dy) % SIDE) * SIDE + (x + dx) % SIDE
            energy[neighbor] += sign * weight

    def extremum(value):
        candidates = (i for i in range(COUNT) if occupied[i] == value)
        return (max if value else min)(candidates, key=energy.__getitem__)

    points = initial_points()
    for index in points:
        set_point(index, 1)
    # Relax the seed pattern until the densest cluster is also the best available void.
    while True:
        dense = extremum(1)
        set_point(dense, 0)
        empty = extremum(0)
        set_point(empty, 1)
        if empty == dense:
            break

    seed_pattern, seed_energy = occupied.copy(), energy.copy()
    for rank in reversed(range(len(points))):
        index = extremum(1)
        ranks[index] = rank * 256 // COUNT
        set_point(index, 0)
    occupied, energy = seed_pattern, seed_energy
    for rank in range(len(points), COUNT):
        index = extremum(0)
        ranks[index] = rank * 256 // COUNT
        set_point(index, 1)
    return ranks


def write_grayscale_png(pixels):
    def chunk(tag, data):
        payload = tag + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload))

    header = struct.pack(">IIBBBBB", SIDE, SIDE, 8, 0, 0, 0, 0)
    rows = b"".join(b"\0" + pixels[i:i + SIDE] for i in range(0, COUNT, SIDE))
    description = b"Description\0Original toroidal void-and-cluster rank tile; xorshift seed 1ca73f5d, Gaussian sigma 1.5."
    OUTPUT.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"tEXt", description)
                       + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    write_grayscale_png(make_ranks())
