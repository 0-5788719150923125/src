# Cut a corpus for crawl.mjs: prose documents, each exactly DOC bytes,
# concatenated. Needs pyarrow.
#
#   python next/cut_corpus.py <text-column.parquet> <corpus.bin> <how-many>
import sys, pyarrow.parquet as pq
src, out, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
DOC = 4096
n = 0
seen = 0
with open(out, 'wb') as f:
    for batch in pq.ParquetFile(src).iter_batches(batch_size=512, columns=['text']):
        for t in batch.column(0).to_pylist():
            seen += 1
            b = t.encode('utf-8', 'ignore')
            if len(b) < DOC + 512:
                continue
            b = b[256:256 + DOC]  # skip the first lines, often a header
            prose = sum(1 for c in b if c == 32 or 97 <= c <= 122 or 65 <= c <= 90)
            if prose < DOC * 0.9 or any(c > 126 for c in b):
                continue
            f.write(b)
            n += 1
            if n >= want:
                break
        if n >= want:
            break
print(f'kept {n} of {seen} documents, {n * DOC} bytes')
