/* Test-only driver for the published MTX Appendix C codec; project MIT license.
 * The generator concatenates the reference source before this file. */
void *MTX_mem_malloc(MTX_MemHandler *t, unsigned long n) {
  void *p = malloc(n ? n : 1);
  if (!p) exit(70);
  return p;
}
void *MTX_mem_realloc(MTX_MemHandler *t, void *p, unsigned long n) {
  p = realloc(p, n ? n : 1);
  if (!p) exit(70);
  return p;
}
void MTX_mem_free(MTX_MemHandler *t, void *p) { free(p); }

int main(int argc, char **argv) {
  if (argc != 5) return 64;
  FILE *in = fopen(argv[2], "rb"), *out = fopen(argv[3], "wb");
  if (!in || !out) return 66;
  fseek(in, 0, SEEK_END);
  long length = ftell(in);
  rewind(in);
  unsigned char *data = malloc(length ? length : 1);
  if (fread(data, 1, length, in) != length) return 74;
  fclose(in);
  MTX_MemHandler mem = {0};
  int error = setjmp(mem.env);
  if (error) { fprintf(stderr, "reference error %d\n", error); return 65; }
  LZCOMP *lz = MTX_LZCOMP_Create2(&mem, atol(argv[4]));
  long size = 0;
  unsigned char *result;
  if (argv[1][0] == 's') {
    FILE *commands = fopen(argv[2], "r");
    long declared, rle;
    if (fscanf(commands, "%ld %ld", &declared, &rle) != 2) return 65;
    lz->length1 = declared;
    SetDistRange(lz, declared);
    result = MTX_mem_malloc(&mem, 1024);
    lz->bitOut = MTX_BITIO_Create(&mem, result, 1024, 'w');
    MTX_BITIO_output_bit(lz->bitOut, rle);
    MTX_BITIO_WriteValue(lz->bitOut, declared, 24);
    lz->sym_ecoder = MTX_AHUFF_Create(&mem, lz->bitOut, lz->NUM_SYMS);
    lz->len_ecoder = MTX_AHUFF_Create(&mem, lz->bitOut, 8);
    lz->dist_ecoder = MTX_AHUFF_Create(&mem, lz->bitOut, 8);
    char kind;
    long a, b;
    while (fscanf(commands, " %c %ld %ld", &kind, &a, &b) == 3) {
      if (kind == 'l') MTX_AHUFF_WriteSymbol(lz->sym_ecoder, a);
      else if (kind == 'd') MTX_AHUFF_WriteSymbol(lz->sym_ecoder, lz->DUP2 + (a - 2) / 2);
      else if (kind == 'c') {
        long ranges = 1, maximum = 8;
        while (maximum < b) { ranges++; maximum *= 8; }
        EncodeLength(lz, a, b, ranges);
        EncodeDistance2(lz, b, ranges);
      } else if (kind == 'r') {
        AHUFF *tree = a == 0 ? lz->sym_ecoder : a == 1 ? lz->len_ecoder : lz->dist_ecoder;
        MTX_AHUFF_WriteSymbol(tree, b);
      } else return 65;
    }
    fclose(commands);
    MTX_BITIO_flush_bits(lz->bitOut);
    size = MTX_BITIO_GetBytesOut(lz->bitOut);
    result = MTX_BITIO_GetMemoryPointer(lz->bitOut);
    MTX_BITIO_Destroy(lz->bitOut);
    MTX_AHUFF_Destroy(lz->sym_ecoder);
    MTX_AHUFF_Destroy(lz->len_ecoder);
    MTX_AHUFF_Destroy(lz->dist_ecoder);
  } else {
    result = argv[1][0] == 'p'
      ? MTX_LZCOMP_PackMemory(lz, data, length, &size)
      : MTX_LZCOMP_UnPackMemory(lz, data, length, &size, 3);
  }
  if (fwrite(result, 1, size, out) != size) return 74;
  fclose(out);
  MTX_mem_free(&mem, result);
  MTX_LZCOMP_Destroy(lz);
  free(data);
  return 0;
}
