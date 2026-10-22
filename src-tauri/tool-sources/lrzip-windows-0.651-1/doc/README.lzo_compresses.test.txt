An explanation of the revised lzo_compresses function in stream.c.

The modifications to the lrzip program for 0.19 centered around an
attempt to catch data chunks that would cause lzma compression to either
take an inordinately long time or not complete at all. The files that
could cause problems for lzma are already-compressed files, multimedia
files, files that have compressed files in them, and files with
randomized data (such as an encrypted volume or file).

The lzo_compresses function is used to assess the data and return
a TRUE or FALSE to the lzma_compress_buf function based on whether or
not the function determined the data to be compressible or not. The
simple formula cdata < odata was used (c=compressed, o=original).

Some test cases were slipping through and caused the hangups. Beginning
with lrzip-0.19 a new option, -T, test compression threshold has been
introduced and sets configurable limits as to what is considered a
compressible data chunk and what is not.

In addition, with very large chunks of data, a small modification was
made to the initial test buffer size to make it more representative of
the entire sample.

To go along with this, increased verbosity was added to the function
so that the user/evaluator can better see what is going on. -v or -vv
can be used to increase informational output.

Functional Overview:

Data chunks are passed to the lzo_copresses function in two streams.
The first is the small data set in the primary hashing bucket which
can be seen when using the -v or -vv option. This is normally a small
sample. The second stream will be the rest. The size of the streams
are dependent on how the long range analysis that is performed on
the entire file and available memory.

After analysis of the data chunk, a value of TRUE or FALSE is returned
and lzma compression will either commence or be skipped. If skipped,
data written out to the .lrz file will simply be the rzip data which
is the reorganized data based on long range analysis.

The lzo_compresses function traverses through the data chunk comparing
larger and larger blocks. If suitable compression ratios are found,
the function ends and returns TRUE. If not, and the largest sample
block size has been reached, the function will traverse deeper into
the chunk and analyze that region. Anytime a compressible area is
found, the function returns TRUE. When the end of the data chunk has
been reached and no suitable compressible blocks found, the program
will return FALSE.

Under most circumstances, this logic was fine. However, if the test
found a chunk that could only achieve 2% compression, for example,
this type of result could adversely affect the lzma compression
routine. Hence, the concept of a limiting threshold.

The threshold option works as a limiter that forces the lzo_compresses
function to not just compare the estimated compressed size with the
original, but to add a limiting threshold. This ranges a very low
threshold, 1, to a very strict, 10. A threshold of 1 means that for
the function to return TRUE, the estimated compressed data size for
the current data chunk can be between 90-100% of the original size.
This means that almost no compressible data is observed or tested for.
A value of 2, means that the data MUST compress better than 90% of
the original size. However, if the observed compression of the data
chunk is over 90% of the original size, then lzo_compresses will fail.

Each additional threshold value will increase the strictness according
to the following formula

CDS = Observed Compressed Data Size from LZO
ODS = Original Data chunk size
T = Threshold

To return TRUE, CDS < ODS * (1.1-T/10)

At T=1, just 0.01% compression would be OK,
T=2, anything better than 10% would be OK, but under 10% compression would fail.
T=3, anything better 20% would be OK, but under 20% compression would fail.
...
T=10, I can't imagine a use for this. Anything better than 90% compression
would be OK. This would imply that LZO would need to get a 10x compression
ratio.

The following actual output from the lzo_compresses function will help
explain.

22501 in primary bucket (0.805%)
        lzo testing for incompressible data...OK for chunk 43408.
        Compressed size = 52.58% of chunk, 1 Passes
        Progress percentage pausing during lzma compression...
        lzo testing for incompressible data...FAILED - below threshold for chunk 523245383. 
        Compressed size = 98.87% of chunk, 50 Passes

This was for a video .VOB file of 1GB. A compression threshold of 2 was used.
-T 2 means that the estimated compression size of the data chunk had to be
better than 90% of the original size.

There were 43,408 bytes in the primary hash bucket and this chunk was
evaluated by lzo_compresses. The function estimated that the compressed
data size would be 52.58% of the original 43,408 byte chunk. This resulted
in LZMA compression occurring.

The second data chunk which included the rest of the data in the current hash,
523,245,383 bytes, failed the test. the lzo_compresses function made 50 passes
through the data using progressively larger samples until it reached the end
of the data chunk. It could not find better than a 1.2% compression benefit
and therefore FAILED, The result was NO LZMA compression and the data chunk
was written to the .lrz file in rzip format (no compression).

The higher the threshold option, the faster the LZMA compression will occur.
However, this could also cause some chunks that are compressible to be
omitted. After much testing, -T 2 seems to work very well in stopping data
which will cause LZMA to hang yet allow most compressible data to come
through.

Peter Hyman
pete@peterhyman.com
December 2007
