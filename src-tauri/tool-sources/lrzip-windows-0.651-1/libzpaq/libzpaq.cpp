/* libzpaq.cpp - Part of LIBZPAQ Version 5.01

  Copyright (C) 2011, Dell Inc. Written by Matt Mahoney.

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so without restriction.
  This Software is provided "as is" without warranty.

LIBZPAQ is a C++ library for compression and decompression of data
conforming to the ZPAQ level 2 standard. See http://mattmahoney.net/zpaq/
*/

#include "libzpaq.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#ifndef NOJIT
#ifndef _WIN32
#include <sys/mman.h>
#else
#include <windows.h>
#endif
#endif

namespace libzpaq {

// Standard library redirections
void* calloc(size_t a, size_t b) {return ::calloc(a, b);}
void free(void* p) {::free(p);}
int memcmp(const void* d, const void* s, size_t n) {
  return ::memcmp(d, s, n);}
void* memset(void* d, int c, size_t n) {return ::memset(d, c, n);}
double log(double x) {return ::log(x);}
double exp(double x) {return ::exp(x);}
double pow(double x, double y) {return ::pow(x, y);}

// Read 16 bit little-endian number
int toU16(const char* p) {
  return (p[0]&255)+256*(p[1]&255);
}

// Default read() and write()
int Reader::read(char* buf, int n) {
  int i=0, c;
  while (i<n && (c=get())>=0)
    buf[i++]=c;
  return i;
}

void Writer::write(const char* buf, int n) {
  for (int i=0; i<n; ++i)
    put(U8(buf[i]));
}

void error(const char* msg) {
  fprintf(stderr, "zpipe error: %s\n", msg);
  exit(1);
}
///////////////////////// allocx //////////////////////

// Allocate newsize > 0 bytes of executable memory and update
// p to point to it and newsize = n. Free any previously
// allocated memory first. If newsize is 0 then free only.
// Call error in case of failure. If NOJIT, ignore newsize
// and set p=0, n=0 without allocating memory.
void allocx(U8* &p, int &n, int newsize) {
#ifdef NOJIT
  p=0;
  n=0;
#else
  if (p || n) {
    if (p)
#ifndef _WIN32
      munmap(p, n);
#else // Windows
      VirtualFree(p, 0, MEM_RELEASE);
#endif
    p=0;
    n=0;
  }
  if (newsize>0) {
#ifndef _WIN32
    p=(U8*)mmap(0, newsize, PROT_READ|PROT_WRITE|PROT_EXEC,
                MAP_PRIVATE|MAP_ANON, -1, 0);
    if ((void*)p==MAP_FAILED) p=0;
#else
    p=(U8*)VirtualAlloc(0, newsize, MEM_RESERVE|MEM_COMMIT,
                        PAGE_EXECUTE_READWRITE);
#endif
    if (p)
      n=newsize;
    else {
      n=0;
      error("allocx failed");
    }
  }
#endif
}

//////////////////////////// SHA1 ////////////////////////////

// SHA1 code, see http://en.wikipedia.org/wiki/SHA-1

// Start a new hash
void SHA1::init() {
  len0=len1=0;
  h[0]=0x67452301;
  h[1]=0xEFCDAB89;
  h[2]=0x98BADCFE;
  h[3]=0x10325476;
  h[4]=0xC3D2E1F0;
}

// Return old result and start a new hash
const char* SHA1::result() {

  // pad and append length
  const U32 s1=len1, s0=len0;
  put(0x80);
  while ((len0&511)!=448)
    put(0);
  put(s1>>24);
  put(s1>>16);
  put(s1>>8);
  put(s1);
  put(s0>>24);
  put(s0>>16);
  put(s0>>8);
  put(s0);

  // copy h to hbuf
  for (int i=0; i<5; ++i) {
    hbuf[4*i]=h[i]>>24;
    hbuf[4*i+1]=h[i]>>16;
    hbuf[4*i+2]=h[i]>>8;
    hbuf[4*i+3]=h[i];
  }

  // return hash prior to clearing state
  init();
  return hbuf;
}

// Hash 1 block of 64 bytes
void SHA1::process() {
  for (int i=16; i<80; ++i) {
    w[i]=w[i-3]^w[i-8]^w[i-14]^w[i-16];
    w[i]=w[i]<<1|w[i]>>31;
  }
  U32 a=h[0];
  U32 b=h[1];
  U32 c=h[2];
  U32 d=h[3];
  U32 e=h[4];
  const U32 k1=0x5A827999, k2=0x6ED9EBA1, k3=0x8F1BBCDC, k4=0xCA62C1D6;
#define f1(a,b,c,d,e,i) e+=(a<<5|a>>27)+((b&c)|(~b&d))+k1+w[i]; b=b<<30|b>>2;
#define f5(i) f1(a,b,c,d,e,i) f1(e,a,b,c,d,i+1) f1(d,e,a,b,c,i+2) \
              f1(c,d,e,a,b,i+3) f1(b,c,d,e,a,i+4)
  f5(0) f5(5) f5(10) f5(15)
#undef f1
#define f1(a,b,c,d,e,i) e+=(a<<5|a>>27)+(b^c^d)+k2+w[i]; b=b<<30|b>>2;
  f5(20) f5(25) f5(30) f5(35)
#undef f1
#define f1(a,b,c,d,e,i) e+=(a<<5|a>>27)+((b&c)|(b&d)|(c&d))+k3+w[i]; b=b<<30|b>>2;
  f5(40) f5(45) f5(50) f5(55)
#undef f1
#define f1(a,b,c,d,e,i) e+=(a<<5|a>>27)+(b^c^d)+k4+w[i]; b=b<<30|b>>2;
  f5(60) f5(65) f5(70) f5(75)
#undef f1
#undef f5
  h[0]+=a;
  h[1]+=b;
  h[2]+=c;
  h[3]+=d;
  h[4]+=e;
}

//////////////////////////// Component ///////////////////////

// A Component is a context model, indirect context model, match model,
// fixed weight mixer, adaptive 2 input mixer without or with current
// partial byte as context, adaptive m input mixer (without or with),
// or SSE (without or with).

const int compsize[256]={0,2,3,2,3,4,6,6,3,5};

void Component::init() {
  limit=cxt=a=b=c=0;
  cm.resize(0);
  ht.resize(0);
  a16.resize(0);
}

////////////////////////// StateTable //////////////////////////

// How many states with count of n0 zeros, n1 ones (0...2)
int StateTable::num_states(int n0, int n1) {
  const int B=6;
  const int bound[B]={20,48,15,8,6,5}; // n0 -> max n1, n1 -> max n0
  if (n0<n1) return num_states(n1, n0);
  if (n0<0 || n1<0 || n1>=B || n0>bound[n1]) return 0;
  return 1+(n1>0 && n0+n1<=17);
}

// New value of count n0 if 1 is observed (and vice versa)
void StateTable::discount(int& n0) {
  n0=(n0>=1)+(n0>=2)+(n0>=3)+(n0>=4)+(n0>=5)+(n0>=7)+(n0>=8);
}

// compute next n0,n1 (0 to N) given input y (0 or 1)
void StateTable::next_state(int& n0, int& n1, int y) {
  if (n0<n1)
    next_state(n1, n0, 1-y);
  else {
    if (y) {
      ++n1;
      discount(n0);
    }
    else {
      ++n0;
      discount(n1);
    }
    // 20,0,0 -> 20,0
    // 48,1,0 -> 48,1
    // 15,2,0 -> 8,1
    //  8,3,0 -> 6,2
    //  8,3,1 -> 5,3
    //  6,4,0 -> 5,3
    //  5,5,0 -> 5,4
    //  5,5,1 -> 4,5
    while (!num_states(n0, n1)) {
      if (n1<2) --n0;
      else {
        n0=(n0*(n1-1)+(n1/2))/n1;
        --n1;
      }
    }
  }
}

// Initialize next state table ns[state*4] -> next if 0, next if 1, n0, n1
StateTable::StateTable() {

  // Assign states by increasing priority
  const int N=50;
  U8 t[N][N][2]={{{0}}}; // (n0,n1,y) -> state number
  int state=0;
  for (int i=0; i<N; ++i) {
    for (int n1=0; n1<=i; ++n1) {
      int n0=i-n1;
      int n=num_states(n0, n1);
      assert(n>=0 && n<=2);
      if (n) {
        t[n0][n1][0]=state;
        t[n0][n1][1]=state+n-1;
        state+=n;
      }
    }
  }
       
  // Generate next state table
  memset(ns, 0, sizeof(ns));
  for (int n0=0; n0<N; ++n0) {
    for (int n1=0; n1<N; ++n1) {
      for (int y=0; y<num_states(n0, n1); ++y) {
        int s=t[n0][n1][y];
        assert(s>=0 && s<256);
        int s0=n0, s1=n1;
        next_state(s0, s1, 0);
        assert(s0>=0 && s0<N && s1>=0 && s1<N);
        ns[s*4+0]=t[s0][s1][0];
        s0=n0, s1=n1;
        next_state(s0, s1, 1);
        assert(s0>=0 && s0<N && s1>=0 && s1<N);
        ns[s*4+1]=t[s0][s1][1];
        ns[s*4+2]=n0;
        ns[s*4+3]=n1;
      }
    }
  }
}

/////////////////////////// ZPAQL //////////////////////////

// Write header to out2, return true if HCOMP/PCOMP section is present.
// If pp is true, then write only the postprocessor code.
bool ZPAQL::write(Writer* out2, bool pp) {
  if (header.size()<=6) return false;
  assert(header[0]+256*header[1]==cend-2+hend-hbegin);
  assert(cend>=7);
  assert(hbegin>=cend);
  assert(hend>=hbegin);
  assert(out2);
  if (!pp) {  // if not a postprocessor then write COMP
    for (int i=0; i<cend; ++i)
      out2->put(header[i]);
  }
  else {  // write PCOMP size only
    out2->put((hend-hbegin)&255);
    out2->put((hend-hbegin)>>8);
  }
  for (int i=hbegin; i<hend; ++i)
    out2->put(header[i]);
  return true;
}

// Read header from in2
int ZPAQL::read(Reader* in2) {

  // Get header size and allocate
  int hsize=in2->get();
  hsize+=in2->get()*256;
  header.resize(hsize+300);
  cend=hbegin=hend=0;
  header[cend++]=hsize&255;
  header[cend++]=hsize>>8;
  while (cend<7) header[cend++]=in2->get(); // hh hm ph pm n

  // Read COMP
  int n=header[cend-1];
  for (int i=0; i<n; ++i) {
    int type=in2->get();  // component type
    if (type==-1) error("unexpected end of file");
    header[cend++]=type;  // component type
    int size=compsize[type];
    if (size<1) error("Invalid component type");
    if (cend+size>header.isize()-8) error("COMP list too big");
    for (int j=1; j<size; ++j)
      header[cend++]=in2->get();
  }
  if ((header[cend++]=in2->get())!=0) error("missing COMP END");

  // Insert a guard gap and read HCOMP
  hbegin=hend=cend+128;
  while (hend<hsize+129) {
    assert(hend<header.isize()-8);
    int op=in2->get();
    if (op==-1) error("unexpected end of file");
    header[hend++]=op;
  }
  if ((header[hend++]=in2->get())!=0) error("missing HCOMP END");
  assert(cend>=7 && cend<header.isize());
  assert(hbegin==cend+128 && hbegin<header.isize());
  assert(hend>hbegin && hend<header.isize());
  assert(hsize==header[0]+256*header[1]);
  assert(hsize==cend-2+hend-hbegin);
  allocx(rcode, rcode_size, 0);  // clear JIT code
  return cend+hend-hbegin;
}

// Free memory, but preserve output, sha1 pointers
void ZPAQL::clear() {
  cend=hbegin=hend=0;  // COMP and HCOMP locations
  a=b=c=d=f=pc=0;      // machine state
  header.resize(0);
  h.resize(0);
  m.resize(0);
  r.resize(0);
  allocx(rcode, rcode_size, 0);
}

// Constructor
ZPAQL::ZPAQL() {
  output=0;
  sha1=0;
  rcode=0;
  rcode_size=0;
  clear();
  outbuf.resize(1<<14);
  bufptr=0;
}

ZPAQL::~ZPAQL() {
  allocx(rcode, rcode_size, 0);
}

// Initialize machine state as HCOMP
void ZPAQL::inith() {
  assert(header.isize()>6);
  assert(output==0);
  assert(sha1==0);
  init(header[2], header[3]); // hh, hm
}

// Initialize machine state as PCOMP
void ZPAQL::initp() {
  assert(header.isize()>6);
  init(header[4], header[5]); // ph, pm
}

// Flush pending output
void ZPAQL::flush() {
  if (output) output->write(&outbuf[0], bufptr);
  if (sha1) for (int i=0; i<bufptr; ++i) sha1->put(U8(outbuf[i]));
  bufptr=0;
}

// Return memory requirement in bytes
double ZPAQL::memory() {
  double mem=pow(2.0,header[2]+2)+pow(2.0,header[3])  // hh hm
            +pow(2.0,header[4]+2)+pow(2.0,header[5])  // ph pm
            +header.size();
  int cp=7;  // start of comp list
  for (int i=0; i<header[6]; ++i) {  // n
    assert(cp<cend);
    double size=pow(2.0, header[cp+1]); // sizebits
    switch(header[cp]) {
      case CM: mem+=4*size; break;
      case ICM: mem+=64*size+1024; break;
      case MATCH: mem+=4*size+pow(2.0, header[cp+2]); break; // bufbits
      case MIX2: mem+=2*size; break;
      case MIX: mem+=4*size*header[cp+3]; break; // m
      case ISSE: mem+=64*size+2048; break;
      case SSE: mem+=128*size; break;
    }
    cp+=compsize[header[cp]];
  }
  return mem;
}

// Initialize machine state to run a program.
void ZPAQL::init(int hbits, int mbits) {
  assert(header.isize()>0);
  assert(cend>=7);
  assert(hbegin>=cend+128);
  assert(hend>=hbegin);
  assert(hend<header.isize()-130);
  assert(header[0]+256*header[1]==cend-2+hend-hbegin);
  assert(bufptr==0);
  assert(outbuf.isize()>0);
  h.resize(1, hbits);
  m.resize(1, mbits);
  r.resize(256);
  a=b=c=d=pc=f=0;
}

// Run program on input by interpreting header
void ZPAQL::run0(U32 input) {
  assert(cend>6);
  assert(hbegin>=cend+128);
  assert(hend>=hbegin);
  assert(hend<header.isize()-130);
  assert(m.size()>0);
  assert(h.size()>0);
  assert(header[0]+256*header[1]==cend+hend-hbegin-2);
  pc=hbegin;
  a=input;
  while (execute()) ;
}

// Execute one instruction, return 0 after HALT else 1
int ZPAQL::execute() {
  switch(header[pc++]) {
    case 0: err(); break; // ERROR
    case 1: ++a; break; // A++
    case 2: --a; break; // A--
    case 3: a = ~a; break; // A!
    case 4: a = 0; break; // A=0
    case 7: a = r[header[pc++]]; break; // A=R N
    case 8: swap(b); break; // B<>A
    case 9: ++b; break; // B++
    case 10: --b; break; // B--
    case 11: b = ~b; break; // B!
    case 12: b = 0; break; // B=0
    case 15: b = r[header[pc++]]; break; // B=R N
    case 16: swap(c); break; // C<>A
    case 17: ++c; break; // C++
    case 18: --c; break; // C--
    case 19: c = ~c; break; // C!
    case 20: c = 0; break; // C=0
    case 23: c = r[header[pc++]]; break; // C=R N
    case 24: swap(d); break; // D<>A
    case 25: ++d; break; // D++
    case 26: --d; break; // D--
    case 27: d = ~d; break; // D!
    case 28: d = 0; break; // D=0
    case 31: d = r[header[pc++]]; break; // D=R N
    case 32: swap(m(b)); break; // *B<>A
    case 33: ++m(b); break; // *B++
    case 34: --m(b); break; // *B--
    case 35: m(b) = ~m(b); break; // *B!
    case 36: m(b) = 0; break; // *B=0
    case 39: if (f) pc+=((header[pc]+128)&255)-127; else ++pc; break; // JT N
    case 40: swap(m(c)); break; // *C<>A
    case 41: ++m(c); break; // *C++
    case 42: --m(c); break; // *C--
    case 43: m(c) = ~m(c); break; // *C!
    case 44: m(c) = 0; break; // *C=0
    case 47: if (!f) pc+=((header[pc]+128)&255)-127; else ++pc; break; // JF N
    case 48: swap(h(d)); break; // *D<>A
    case 49: ++h(d); break; // *D++
    case 50: --h(d); break; // *D--
    case 51: h(d) = ~h(d); break; // *D!
    case 52: h(d) = 0; break; // *D=0
    case 55: r[header[pc++]] = a; break; // R=A N
    case 56: return 0  ; // HALT
    case 57: outc(a&255); break; // OUT
    case 59: a = (a+m(b)+512)*773; break; // HASH
    case 60: h(d) = (h(d)+a+512)*773; break; // HASHD
    case 63: pc+=((header[pc]+128)&255)-127; break; // JMP N
    case 64: break; // A=A
    case 65: a = b; break; // A=B
    case 66: a = c; break; // A=C
    case 67: a = d; break; // A=D
    case 68: a = m(b); break; // A=*B
    case 69: a = m(c); break; // A=*C
    case 70: a = h(d); break; // A=*D
    case 71: a = header[pc++]; break; // A= N
    case 72: b = a; break; // B=A
    case 73: break; // B=B
    case 74: b = c; break; // B=C
    case 75: b = d; break; // B=D
    case 76: b = m(b); break; // B=*B
    case 77: b = m(c); break; // B=*C
    case 78: b = h(d); break; // B=*D
    case 79: b = header[pc++]; break; // B= N
    case 80: c = a; break; // C=A
    case 81: c = b; break; // C=B
    case 82: break; // C=C
    case 83: c = d; break; // C=D
    case 84: c = m(b); break; // C=*B
    case 85: c = m(c); break; // C=*C
    case 86: c = h(d); break; // C=*D
    case 87: c = header[pc++]; break; // C= N
    case 88: d = a; break; // D=A
    case 89: d = b; break; // D=B
    case 90: d = c; break; // D=C
    case 91: break; // D=D
    case 92: d = m(b); break; // D=*B
    case 93: d = m(c); break; // D=*C
    case 94: d = h(d); break; // D=*D
    case 95: d = header[pc++]; break; // D= N
    case 96: m(b) = a; break; // *B=A
    case 97: m(b) = b; break; // *B=B
    case 98: m(b) = c; break; // *B=C
    case 99: m(b) = d; break; // *B=D
    case 100: m(b) = m(b); break; // *B=*B
    case 101: m(b) = m(c); break; // *B=*C
    case 102: m(b) = h(d); break; // *B=*D
    case 103: m(b) = header[pc++]; break; // *B= N
    case 104: m(c) = a; break; // *C=A
    case 105: m(c) = b; break; // *C=B
    case 106: m(c) = c; break; // *C=C
    case 107: m(c) = d; break; // *C=D
    case 108: m(c) = m(b); break; // *C=*B
    case 109: m(c) = m(c); break; // *C=*C
    case 110: m(c) = h(d); break; // *C=*D
    case 111: m(c) = header[pc++]; break; // *C= N
    case 112: h(d) = a; break; // *D=A
    case 113: h(d) = b; break; // *D=B
    case 114: h(d) = c; break; // *D=C
    case 115: h(d) = d; break; // *D=D
    case 116: h(d) = m(b); break; // *D=*B
    case 117: h(d) = m(c); break; // *D=*C
    case 118: h(d) = h(d); break; // *D=*D
    case 119: h(d) = header[pc++]; break; // *D= N
    case 128: a += a; break; // A+=A
    case 129: a += b; break; // A+=B
    case 130: a += c; break; // A+=C
    case 131: a += d; break; // A+=D
    case 132: a += m(b); break; // A+=*B
    case 133: a += m(c); break; // A+=*C
    case 134: a += h(d); break; // A+=*D
    case 135: a += header[pc++]; break; // A+= N
    case 136: a -= a; break; // A-=A
    case 137: a -= b; break; // A-=B
    case 138: a -= c; break; // A-=C
    case 139: a -= d; break; // A-=D
    case 140: a -= m(b); break; // A-=*B
    case 141: a -= m(c); break; // A-=*C
    case 142: a -= h(d); break; // A-=*D
    case 143: a -= header[pc++]; break; // A-= N
    case 144: a *= a; break; // A*=A
    case 145: a *= b; break; // A*=B
    case 146: a *= c; break; // A*=C
    case 147: a *= d; break; // A*=D
    case 148: a *= m(b); break; // A*=*B
    case 149: a *= m(c); break; // A*=*C
    case 150: a *= h(d); break; // A*=*D
    case 151: a *= header[pc++]; break; // A*= N
    case 152: div(a); break; // A/=A
    case 153: div(b); break; // A/=B
    case 154: div(c); break; // A/=C
    case 155: div(d); break; // A/=D
    case 156: div(m(b)); break; // A/=*B
    case 157: div(m(c)); break; // A/=*C
    case 158: div(h(d)); break; // A/=*D
    case 159: div(header[pc++]); break; // A/= N
    case 160: mod(a); break; // A%=A
    case 161: mod(b); break; // A%=B
    case 162: mod(c); break; // A%=C
    case 163: mod(d); break; // A%=D
    case 164: mod(m(b)); break; // A%=*B
    case 165: mod(m(c)); break; // A%=*C
    case 166: mod(h(d)); break; // A%=*D
    case 167: mod(header[pc++]); break; // A%= N
    case 168: a &= a; break; // A&=A
    case 169: a &= b; break; // A&=B
    case 170: a &= c; break; // A&=C
    case 171: a &= d; break; // A&=D
    case 172: a &= m(b); break; // A&=*B
    case 173: a &= m(c); break; // A&=*C
    case 174: a &= h(d); break; // A&=*D
    case 175: a &= header[pc++]; break; // A&= N
    case 176: a &= ~ a; break; // A&~A
    case 177: a &= ~ b; break; // A&~B
    case 178: a &= ~ c; break; // A&~C
    case 179: a &= ~ d; break; // A&~D
    case 180: a &= ~ m(b); break; // A&~*B
    case 181: a &= ~ m(c); break; // A&~*C
    case 182: a &= ~ h(d); break; // A&~*D
    case 183: a &= ~ header[pc++]; break; // A&~ N
    case 184: a |= a; break; // A|=A
    case 185: a |= b; break; // A|=B
    case 186: a |= c; break; // A|=C
    case 187: a |= d; break; // A|=D
    case 188: a |= m(b); break; // A|=*B
    case 189: a |= m(c); break; // A|=*C
    case 190: a |= h(d); break; // A|=*D
    case 191: a |= header[pc++]; break; // A|= N
    case 192: a ^= a; break; // A^=A
    case 193: a ^= b; break; // A^=B
    case 194: a ^= c; break; // A^=C
    case 195: a ^= d; break; // A^=D
    case 196: a ^= m(b); break; // A^=*B
    case 197: a ^= m(c); break; // A^=*C
    case 198: a ^= h(d); break; // A^=*D
    case 199: a ^= header[pc++]; break; // A^= N
    case 200: a <<= (a&31); break; // A<<=A
    case 201: a <<= (b&31); break; // A<<=B
    case 202: a <<= (c&31); break; // A<<=C
    case 203: a <<= (d&31); break; // A<<=D
    case 204: a <<= (m(b)&31); break; // A<<=*B
    case 205: a <<= (m(c)&31); break; // A<<=*C
    case 206: a <<= (h(d)&31); break; // A<<=*D
    case 207: a <<= (header[pc++]&31); break; // A<<= N
    case 208: a >>= (a&31); break; // A>>=A
    case 209: a >>= (b&31); break; // A>>=B
    case 210: a >>= (c&31); break; // A>>=C
    case 211: a >>= (d&31); break; // A>>=D
    case 212: a >>= (m(b)&31); break; // A>>=*B
    case 213: a >>= (m(c)&31); break; // A>>=*C
    case 214: a >>= (h(d)&31); break; // A>>=*D
    case 215: a >>= (header[pc++]&31); break; // A>>= N
    case 216: f = (true); break; // A==A
    case 217: f = (a == b); break; // A==B
    case 218: f = (a == c); break; // A==C
    case 219: f = (a == d); break; // A==D
    case 220: f = (a == U32(m(b))); break; // A==*B
    case 221: f = (a == U32(m(c))); break; // A==*C
    case 222: f = (a == h(d)); break; // A==*D
    case 223: f = (a == U32(header[pc++])); break; // A== N
    case 224: f = (false); break; // A<A
    case 225: f = (a < b); break; // A<B
    case 226: f = (a < c); break; // A<C
    case 227: f = (a < d); break; // A<D
    case 228: f = (a < U32(m(b))); break; // A<*B
    case 229: f = (a < U32(m(c))); break; // A<*C
    case 230: f = (a < h(d)); break; // A<*D
    case 231: f = (a < U32(header[pc++])); break; // A< N
    case 232: f = (false); break; // A>A
    case 233: f = (a > b); break; // A>B
    case 234: f = (a > c); break; // A>C
    case 235: f = (a > d); break; // A>D
    case 236: f = (a > U32(m(b))); break; // A>*B
    case 237: f = (a > U32(m(c))); break; // A>*C
    case 238: f = (a > h(d)); break; // A>*D
    case 239: f = (a > U32(header[pc++])); break; // A> N
    case 255: if((pc=hbegin+header[pc]+256*header[pc+1])>=hend)err();break;//LJ
    default: err();
  }
  return 1;
}

// Print illegal instruction error message and exit
void ZPAQL::err() {
  error("ZPAQL execution error");
}

///////////////////////// Predictor /////////////////////////

// Initailize model-independent tables
Predictor::Predictor(ZPAQL& zr):
    c8(1), hmap4(1), z(zr) {
  assert(sizeof(U8)==1);
  assert(sizeof(U16)==2);
  assert(sizeof(U32)==4);
  assert(sizeof(U64)==8);
  assert(sizeof(short)==2);
  assert(sizeof(int)==4);

  // Initialize tables
  dt2k[0]=0;
  for (int i=1; i<256; ++i)
    dt2k[i]=2048/i;
  for (int i=0; i<1024; ++i)
    dt[i]=(1<<17)/(i*2+3)*2;
  for (int i=0; i<32768; ++i)
    stretcht[i]=int(log((i+0.5)/(32767.5-i))*64+0.5+100000)-100000;
  for (int i=0; i<4096; ++i)
    squasht[i]=int(32768.0/(1+exp((i-2048)*(-1.0/64))));

  // Verify floating point math for squash() and stretch()
  U32 sqsum=0, stsum=0;
  for (int i=32767; i>=0; --i)
    stsum=stsum*3+stretch(i);
  for (int i=4095; i>=0; --i)
    sqsum=sqsum*3+squash(i-2048);
  assert(stsum==3887533746u);
  assert(sqsum==2278286169u);

  pcode=0;
  pcode_size=0;
}

Predictor::~Predictor() {
  allocx(pcode, pcode_size, 0);  // free executable memory
}

// Initialize the predictor with a new model in z
void Predictor::init() {

  // Clear old JIT code if any
  allocx(pcode, pcode_size, 0);

  // Initialize context hash function
  z.inith();

  // Initialize predictions
  for (int i=0; i<256; ++i) h[i]=p[i]=0;

  // Initialize components
  for (int i=0; i<256; ++i)  // clear old model
    comp[i].init();
  int n=z.header[6]; // hsize[0..1] hh hm ph pm n (comp)[n] END 0[128] (hcomp) END
  const U8* cp=&z.header[7];  // start of component list
  for (int i=0; i<n; ++i) {
    assert(cp<&z.header[z.cend]);
    assert(cp>&z.header[0] && cp<&z.header[z.header.isize()-8]);
    Component& cr=comp[i];
    switch(cp[0]) {
      case CONS:  // c
        p[i]=(cp[1]-128)*4;
        break;
      case CM: // sizebits limit
        if (cp[1]>32) error("max size for CM is 32");
        cr.cm.resize(1, cp[1]);  // packed CM (22 bits) + CMCOUNT (10 bits)
        cr.limit=cp[2]*4;
        for (size_t j=0; j<cr.cm.size(); ++j)
          cr.cm[j]=0x80000000;
        break;
      case ICM: // sizebits
        if (cp[1]>26) error("max size for ICM is 26");
        cr.limit=1023;
        cr.cm.resize(256);
        cr.ht.resize(64, cp[1]);
        for (size_t j=0; j<cr.cm.size(); ++j)
          cr.cm[j]=st.cminit(j);
        break;
      case MATCH:  // sizebits
        if (cp[1]>32 || cp[2]>32) error("max size for MATCH is 32 32");
        cr.cm.resize(1, cp[1]);  // index
        cr.ht.resize(1, cp[2]);  // buf
        cr.ht(0)=1;
        break;
      case AVG: // j k wt
        if (cp[1]>=i) error("AVG j >= i");
        if (cp[2]>=i) error("AVG k >= i");
        break;
      case MIX2:  // sizebits j k rate mask
        if (cp[1]>32) error("max size for MIX2 is 32");
        if (cp[3]>=i) error("MIX2 k >= i");
        if (cp[2]>=i) error("MIX2 j >= i");
        cr.c=(size_t(1)<<cp[1]); // size (number of contexts)
        cr.a16.resize(1, cp[1]);  // wt[size][m]
        for (size_t j=0; j<cr.a16.size(); ++j)
          cr.a16[j]=32768;
        break;
      case MIX: {  // sizebits j m rate mask
        if (cp[1]>32) error("max size for MIX is 32");
        if (cp[2]>=i) error("MIX j >= i");
        if (cp[3]<1 || cp[3]>i-cp[2]) error("MIX m not in 1..i-j");
        int m=cp[3];  // number of inputs
        assert(m>=1);
        cr.c=(size_t(1)<<cp[1]); // size (number of contexts)
        cr.cm.resize(m, cp[1]);  // wt[size][m]
        for (size_t j=0; j<cr.cm.size(); ++j)
          cr.cm[j]=65536/m;
        break;
      }
      case ISSE:  // sizebits j
        if (cp[1]>32) error("max size for ISSE is 32");
        if (cp[2]>=i) error("ISSE j >= i");
        cr.ht.resize(64, cp[1]);
        cr.cm.resize(512);
        for (int j=0; j<256; ++j) {
          cr.cm[j*2]=1<<15;
          cr.cm[j*2+1]=clamp512k(stretch(st.cminit(j)>>8)<<10);
        }
        break;
      case SSE: // sizebits j start limit
        if (cp[1]>32) error("max size for SSE is 32");
        if (cp[2]>=i) error("SSE j >= i");
        if (cp[3]>cp[4]*4) error("SSE start > limit*4");
        cr.cm.resize(32, cp[1]);
        cr.limit=cp[4]*4;
        for (size_t j=0; j<cr.cm.size(); ++j)
          cr.cm[j]=squash((j&31)*64-992)<<17|cp[3];
        break;
      default: error("unknown component type");
    }
    assert(compsize[*cp]>0);
    cp+=compsize[*cp];
    assert(cp>=&z.header[7] && cp<&z.header[z.cend]);
  }
}

// Return next bit prediction using interpreted COMP code
int Predictor::predict0() {
  assert(c8>=1 && c8<=255);

  // Predict next bit
  int n=z.header[6];
  assert(n>0 && n<=255);
  const U8* cp=&z.header[7];
  assert(cp[-1]==n);
  for (int i=0; i<n; ++i) {
    assert(cp>&z.header[0] && cp<&z.header[z.header.isize()-8]);
    Component& cr=comp[i];
    switch(cp[0]) {
      case CONS:  // c
        break;
      case CM:  // sizebits limit
        cr.cxt=h[i]^hmap4;
        p[i]=stretch(cr.cm(cr.cxt)>>17);
        break;
      case ICM: // sizebits
        assert((hmap4&15)>0);
        if (c8==1 || (c8&0xf0)==16) cr.c=find(cr.ht, cp[1]+2, h[i]+16*c8);
        cr.cxt=cr.ht[cr.c+(hmap4&15)];
        p[i]=stretch(cr.cm(cr.cxt)>>8);
        break;
      case MATCH: // sizebits bufbits: a=len, b=offset, c=bit, cxt=bitpos,
                  //                   ht=buf, limit=pos
        assert(cr.cm.size()==(size_t(1)<<cp[1]));
        assert(cr.ht.size()==(size_t(1)<<cp[2]));
        assert(cr.a<=255);
        assert(cr.c==0 || cr.c==1);
        assert(cr.cxt<8);
        assert(cr.limit<cr.ht.size());
        if (cr.a==0) p[i]=0;
        else {
          cr.c=(cr.ht(cr.limit-cr.b)>>(7-cr.cxt))&1; // predicted bit
          p[i]=stretch(dt2k[cr.a]*(cr.c*-2+1)&32767);
        }
        break;
      case AVG: // j k wt
        p[i]=(p[cp[1]]*cp[3]+p[cp[2]]*(256-cp[3]))>>8;
        break;
      case MIX2: { // sizebits j k rate mask
                   // c=size cm=wt[size] cxt=input
        cr.cxt=((h[i]+(c8&cp[5]))&(cr.c-1));
        assert(cr.cxt<cr.a16.size());
        int w=cr.a16[cr.cxt];
        assert(w>=0 && w<65536);
        p[i]=(w*p[cp[2]]+(65536-w)*p[cp[3]])>>16;
        assert(p[i]>=-2048 && p[i]<2048);
      }
        break;
      case MIX: {  // sizebits j m rate mask
                   // c=size cm=wt[size][m] cxt=index of wt in cm
        int m=cp[3];
        assert(m>=1 && m<=i);
        cr.cxt=h[i]+(c8&cp[5]);
        cr.cxt=(cr.cxt&(cr.c-1))*m; // pointer to row of weights
        assert(cr.cxt<=cr.cm.size()-m);
        int* wt=(int*)&cr.cm[cr.cxt];
        p[i]=0;
        for (int j=0; j<m; ++j)
          p[i]+=(wt[j]>>8)*p[cp[2]+j];
        p[i]=clamp2k(p[i]>>8);
      }
        break;
      case ISSE: { // sizebits j -- c=hi, cxt=bh
        assert((hmap4&15)>0);
        if (c8==1 || (c8&0xf0)==16)
          cr.c=find(cr.ht, cp[1]+2, h[i]+16*c8);
        cr.cxt=cr.ht[cr.c+(hmap4&15)];  // bit history
        int *wt=(int*)&cr.cm[cr.cxt*2];
        p[i]=clamp2k((wt[0]*p[cp[2]]+wt[1]*64)>>16);
      }
        break;
      case SSE: { // sizebits j start limit
        cr.cxt=(h[i]+c8)*32;
        int pq=p[cp[2]]+992;
        if (pq<0) pq=0;
        if (pq>1983) pq=1983;
        int wt=pq&63;
        pq>>=6;
        assert(pq>=0 && pq<=30);
        cr.cxt+=pq;
        p[i]=stretch(((cr.cm(cr.cxt)>>10)*(64-wt)+(cr.cm(cr.cxt+1)>>10)*wt)>>13);
        cr.cxt+=wt>>5;
      }
        break;
      default:
        error("component predict not implemented");
    }
    cp+=compsize[cp[0]];
    assert(cp<&z.header[z.cend]);
    assert(p[i]>=-2048 && p[i]<2048);
  }
  assert(cp[0]==NONE);
  return squash(p[n-1]);
}

// Update model with decoded bit y (0...1)
void Predictor::update0(int y) {
  assert(y==0 || y==1);
  assert(c8>=1 && c8<=255);
  assert(hmap4>=1 && hmap4<=511);

  // Update components
  const U8* cp=&z.header[7];
  int n=z.header[6];
  assert(n>=1 && n<=255);
  assert(cp[-1]==n);
  for (int i=0; i<n; ++i) {
    Component& cr=comp[i];
    switch(cp[0]) {
      case CONS:  // c
        break;
      case CM:  // sizebits limit
        train(cr, y);
        break;
      case ICM: { // sizebits: cxt=ht[b]=bh, ht[c][0..15]=bh row, cxt=bh
        cr.ht[cr.c+(hmap4&15)]=st.next(cr.ht[cr.c+(hmap4&15)], y);
        U32& pn=cr.cm(cr.cxt);
        pn+=int(y*32767-(pn>>8))>>2;
      }
        break;
      case MATCH: // sizebits bufbits:
                  //   a=len, b=offset, c=bit, cm=index, cxt=bitpos
                  //   ht=buf, limit=pos
      {
        assert(cr.a<=255);
        assert(cr.c==0 || cr.c==1);
        assert(cr.cxt<8);
        assert(cr.cm.size()==(size_t(1)<<cp[1]));
        assert(cr.ht.size()==(size_t(1)<<cp[2]));
        assert(cr.limit<cr.ht.size());
        if (int(cr.c)!=y) cr.a=0;  // mismatch?
        cr.ht(cr.limit)+=cr.ht(cr.limit)+y;
        if (++cr.cxt==8) {
          cr.cxt=0;
          ++cr.limit;
          cr.limit&=(1<<cp[2])-1;
          if (cr.a==0) {  // look for a match
            cr.b=cr.limit-cr.cm(h[i]);
            if (cr.b&(cr.ht.size()-1))
              while (cr.a<255
                     && cr.ht(cr.limit-cr.a-1)==cr.ht(cr.limit-cr.a-cr.b-1))
                ++cr.a;
          }
          else cr.a+=cr.a<255;
          cr.cm(h[i])=cr.limit;
        }
      }
        break;
      case AVG:  // j k wt
        break;
      case MIX2: { // sizebits j k rate mask
                   // cm=wt[size], cxt=input
        assert(cr.a16.size()==cr.c);
        assert(cr.cxt<cr.a16.size());
        int err=(y*32767-squash(p[i]))*cp[4]>>5;
        int w=cr.a16[cr.cxt];
        w+=(err*(p[cp[2]]-p[cp[3]])+(1<<12))>>13;
        if (w<0) w=0;
        if (w>65535) w=65535;
        cr.a16[cr.cxt]=w;
      }
        break;
      case MIX: {   // sizebits j m rate mask
                    // cm=wt[size][m], cxt=input
        int m=cp[3];
        assert(m>0 && m<=i);
        assert(cr.cm.size()==m*cr.c);
        assert(cr.cxt+m<=cr.cm.size());
        int err=(y*32767-squash(p[i]))*cp[4]>>4;
        int* wt=(int*)&cr.cm[cr.cxt];
        for (int j=0; j<m; ++j)
          wt[j]=clamp512k(wt[j]+((err*p[cp[2]+j]+(1<<12))>>13));
      }
        break;
      case ISSE: { // sizebits j  -- c=hi, cxt=bh
        assert(cr.cxt==cr.ht[cr.c+(hmap4&15)]);
        int err=y*32767-squash(p[i]);
        int *wt=(int*)&cr.cm[cr.cxt*2];
        wt[0]=clamp512k(wt[0]+((err*p[cp[2]]+(1<<12))>>13));
        wt[1]=clamp512k(wt[1]+((err+16)>>5));
        cr.ht[cr.c+(hmap4&15)]=st.next(cr.cxt, y);
      }
        break;
      case SSE:  // sizebits j start limit
        train(cr, y);
        break;
      default:
        assert(0);
    }
    cp+=compsize[cp[0]];
    assert(cp>=&z.header[7] && cp<&z.header[z.cend] 
           && cp<&z.header[z.header.isize()-8]);
  }
  assert(cp[0]==NONE);

  // Save bit y in c8, hmap4
  c8+=c8+y;
  if (c8>=256) {
    z.run(c8-256);
    hmap4=1;
    c8=1;
    for (int i=0; i<n; ++i) h[i]=z.H(i);
  }
  else if (c8>=16 && c8<32)
    hmap4=(hmap4&0xf)<<5|y<<4|1;
  else
    hmap4=(hmap4&0x1f0)|(((hmap4&0xf)*2+y)&0xf);
}

// Find cxt row in hash table ht. ht has rows of 16 indexed by the
// low sizebits of cxt with element 0 having the next higher 8 bits for
// collision detection. If not found after 3 adjacent tries, replace the
// row with lowest element 1 as priority. Return index of row.
size_t Predictor::find(Array<U8>& ht, int sizebits, U32 cxt) {
  assert(ht.size()==size_t(16)<<sizebits);
  int chk=cxt>>sizebits&255;
  size_t h0=(cxt*16)&(ht.size()-16);
  if (ht[h0]==chk) return h0;
  size_t h1=h0^16;
  if (ht[h1]==chk) return h1;
  size_t h2=h0^32;
  if (ht[h2]==chk) return h2;
  if (ht[h0+1]<=ht[h1+1] && ht[h0+1]<=ht[h2+1])
    return memset(&ht[h0], 0, 16), ht[h0]=chk, h0;
  else if (ht[h1+1]<ht[h2+1])
    return memset(&ht[h1], 0, 16), ht[h1]=chk, h1;
  else
    return memset(&ht[h2], 0, 16), ht[h2]=chk, h2;
}

/////////////////////// Decoder ///////////////////////

Decoder::Decoder(ZPAQL& z):
    in(0), low(1), high(0xFFFFFFFF), curr(0), pr(z), buf(BUFSIZE) {
}

void Decoder::init() {
  pr.init();
  if (pr.isModeled()) low=1, high=0xFFFFFFFF, curr=0;
  else low=high=curr=0;
}

// Read un-modeled input into buf[low=0..high-1]
// with curr remaining in subblock to read.
void Decoder::loadbuf() {
  assert(!pr.isModeled());
  assert(low==high);
  if (curr==0) {
    for (int i=0; i<4; ++i) {
      int c=in->get();
      if (c<0) error("unexpected end of input");
      curr=curr<<8|c;
    }
  }
  U32 n=buf.size();
  if (n>curr) n=curr;
  high=in->read(&buf[0], n);
  curr-=high;
  low=0;
}

// Return next bit of decoded input, which has 16 bit probability p of being 1
int Decoder::decode(int p) {
  assert(p>=0 && p<65536);
  assert(high>low && low>0);
  if (curr<low || curr>high) error("archive corrupted");
  assert(curr>=low && curr<=high);
  U32 mid=low+U32(((high-low)*U64(U32(p)))>>16);  // split range
  assert(high>mid && mid>=low);
  int y=curr<=mid;
  if (y) high=mid; else low=mid+1; // pick half
  while ((high^low)<0x1000000) { // shift out identical leading bytes
    high=high<<8|255;
    low=low<<8;
    low+=(low==0);
    int c=in->get();
    if (c<0) error("unexpected end of file");
    curr=curr<<8|c;
  }
  return y;
}

// Decompress 1 byte or -1 at end of input
int Decoder::decompress() {
  if (pr.isModeled()) {  // n>0 components?
    if (curr==0) {  // segment initialization
      for (int i=0; i<4; ++i)
        curr=curr<<8|in->get();
    }
    if (decode(0)) {
      if (curr!=0) error("decoding end of stream");
      return -1;
    }
    else {
      int c=1;
      while (c<256) {  // get 8 bits
        int p=pr.predict()*2+1;
        c+=c+decode(p);
        pr.update(c&1);
      }
      return c-256;
    }
  }
  else {
    if (low==high) loadbuf();
    if (low==high) return -1;
    return buf[low++]&255;
  }
}

// Find end of compressed data and return next byte
int Decoder::skip() {
  int c=-1;
  if (pr.isModeled()) {
    while (curr==0)  // at start?
      curr=in->get();
    while (curr && (c=in->get())>=0)  // find 4 zeros
      curr=curr<<8|c;
    while ((c=in->get())==0) ;  // might be more than 4
    return c;
  }
  else {
    if (curr==0)  // at start?
      for (int i=0; i<4 && (c=in->get())>=0; ++i) curr=curr<<8|c;
    while (curr>0) {
      U32 n=BUFSIZE;
      if (n>curr) n=curr;
      U32 n1=in->read(&buf[0], n);
      curr-=n1;
      if (n1!=n) return -1;
      if (curr==0)
        for (int i=0; i<4 && (c=in->get())>=0; ++i) curr=curr<<8|c;
    }
    if (c>=0) c=in->get();
    return c;
  }
}

////////////////////// PostProcessor //////////////////////

// Copy ph, pm from block header
void PostProcessor::init(int h, int m) {
  state=hsize=0;
  ph=h;
  pm=m;
  z.clear();
}

// (PASS=0 | PROG=1 psize[0..1] pcomp[0..psize-1]) data... EOB=-1
// Return state: 1=PASS, 2..4=loading PROG, 5=PROG loaded
int PostProcessor::write(int c) {
  assert(c>=-1 && c<=255);
  switch (state) {
    case 0:  // initial state
      if (c<0) error("Unexpected EOS");
      state=c+1;  // 1=PASS, 2=PROG
      if (state>2) error("unknown post processing type");
      if (state==1) z.clear();
      break;
    case 1:  // PASS
      z.outc(c);
      break;
    case 2: // PROG
      if (c<0) error("Unexpected EOS");
      hsize=c;  // low byte of size
      state=3;
      break;
    case 3:  // PROG psize[0]
      if (c<0) error("Unexpected EOS");
      hsize+=c*256;  // high byte of psize
      z.header.resize(hsize+300);
      z.cend=8;
      z.hbegin=z.hend=z.cend+128;
      z.header[4]=ph;
      z.header[5]=pm;
      state=4;
      break;
    case 4:  // PROG psize[0..1] pcomp[0...]
      if (c<0) error("Unexpected EOS");
      assert(z.hend<z.header.isize());
      z.header[z.hend++]=c;  // one byte of pcomp
      if (z.hend-z.hbegin==hsize) {  // last byte of pcomp?
        hsize=z.cend-2+z.hend-z.hbegin;
        z.header[0]=hsize&255;  // header size with empty COMP
        z.header[1]=hsize>>8;
        z.initp();
        state=5;
      }
      break;
    case 5:  // PROG ... data
      z.run(c);
      if (c<0) z.flush();
      break;
  }
  return state;
}

/////////////////////// Decompresser /////////////////////

// Find the start of a block and return true if found. Set memptr
// to memory used.
bool Decompresser::findBlock(double* memptr) {
  assert(state==BLOCK);

  // Find start of block
  U32 h1=0x3D49B113, h2=0x29EB7F93, h3=0x2614BE13, h4=0x3828EB13;
  // Rolling hashes initialized to hash of first 13 bytes
  int c;
  while ((c=dec.in->get())!=-1) {
    h1=h1*12+c;
    h2=h2*20+c;
    h3=h3*28+c;
    h4=h4*44+c;
    if (h1==0xB16B88F1 && h2==0xFF5376F1 && h3==0x72AC5BF1 && h4==0x2F909AF1)
      break;  // hash of 16 byte string
  }
  if (c==-1) return false;

  // Read header
  if ((c=dec.in->get())!=1 && c!=2) error("unsupported ZPAQ level");
  if (dec.in->get()!=1) error("unsupported ZPAQL type");
  z.read(dec.in);
  if (c==1 && z.header.isize()>6 && z.header[6]==0)
    error("ZPAQ level 1 requires at least 1 component");
  if (memptr) *memptr=z.memory();
  state=FILENAME;
  decode_state=FIRSTSEG;
  return true;
}

// Read the start of a segment (1) or end of block code (255).
// If a segment is found, write the filename and return true, else false.
bool Decompresser::findFilename(Writer* filename) {
  assert(state==FILENAME);
  int c=dec.in->get();
  if (c==1) {  // segment found
    while (true) {
      c=dec.in->get();
      if (c==-1) error("unexpected EOF");
      if (c==0) {
        state=COMMENT;
        return true;
      }
      if (filename) filename->put(c);
    }
  }
  else if (c==255) {  // end of block found
    state=BLOCK;
    return false;
  }
  else
    error("missing segment or end of block");
  return false;
}

// Read the comment from the segment header
void Decompresser::readComment(Writer* comment) {
  assert(state==COMMENT);
  state=DATA;
  while (true) {
    int c=dec.in->get();
    if (c==-1) error("unexpected EOF");
    if (c==0) break;
    if (comment) comment->put(c);
  }
  if (dec.in->get()!=0) error("missing reserved byte");
}

// Decompress n bytes, or all if n < 0. Return false if done
bool Decompresser::decompress(int n) {
  assert(state==DATA);
  assert(decode_state!=SKIP);

  // Initialize models to start decompressing block
  if (decode_state==FIRSTSEG) {
    dec.init();
    assert(z.header.size()>5);
    pp.init(z.header[4], z.header[5]);
    decode_state=SEG;
  }

  // Decompress and load PCOMP into postprocessor
  while ((pp.getState()&3)!=1)
    pp.write(dec.decompress());

  // Decompress n bytes, or all if n < 0
  while (n) {
    int c=dec.decompress();
    pp.write(c);
    if (c==-1) {
      state=SEGEND;
      return false;
    }
    if (n>0) --n;
  }
  return true;
}

// Read end of block. If a SHA1 checksum is present, write 1 and the
// 20 byte checksum into sha1string, else write 0 in first byte.
// If sha1string is 0 then discard it.
void Decompresser::readSegmentEnd(char* sha1string) {
  assert(state==DATA || state==SEGEND);

  // Skip remaining data if any and get next byte
  int c=0;
  if (state==DATA) {
    c=dec.skip();
    decode_state=SKIP;
  }
  else if (state==SEGEND)
    c=dec.in->get();
  state=FILENAME;

  // Read checksum
  if (c==254) {
    if (sha1string) sha1string[0]=0;  // no checksum
  }
  else if (c==253) {
    if (sha1string) sha1string[0]=1;
    for (int i=1; i<=20; ++i) {
      c=dec.in->get();
      if (sha1string) sha1string[i]=c;
    }
  }
  else
    error("missing end of segment marker");
}

/////////////////////////// decompress() /////////////////////

void decompress(Reader* in, Writer* out) {
  Decompresser d;
  d.setInput(in);
  d.setOutput(out);
  while (d.findBlock()) {       // don't calculate memory
    while (d.findFilename()) {  // discard filename
      d.readComment();          // discard comment
      d.decompress();           // to end of segment
      d.readSegmentEnd();       // discard sha1string
    }
  }
}

////////////////////// Encoder ////////////////////

// Initialize for start of block
void Encoder::init() {
  low=1;
  high=0xFFFFFFFF;
  pr.init();
  if (!pr.isModeled()) low=0, buf.resize(1<<16);
}

// compress bit y having probability p/64K
void Encoder::encode(int y, int p) {
  assert(out);
  assert(p>=0 && p<65536);
  assert(y==0 || y==1);
  assert(high>low && low>0);
  U32 mid=low+U32(((high-low)*U64(U32(p)))>>16);  // split range
  assert(high>mid && mid>=low);
  if (y) high=mid; else low=mid+1; // pick half
  while ((high^low)<0x1000000) { // write identical leading bytes
    out->put(high>>24);  // same as low>>24
    high=high<<8|255;
    low=low<<8;
    low+=(low==0); // so we don't code 4 0 bytes in a row
  }
}

// compress byte c (0..255 or -1=EOS)
void Encoder::compress(int c) {
  assert(out);
  if (pr.isModeled()) {
    if (c==-1)
      encode(1, 0);
    else {
      assert(c>=0 && c<=255);
      encode(0, 0);
      for (int i=7; i>=0; --i) {
        int p=pr.predict()*2+1;
        assert(p>0 && p<65536);
        int y=c>>i&1;
        encode(y, p);
        pr.update(y);
      }
    }
  }
  else {
    if (c<0 || low==buf.size()) {
      out->put((low>>24)&255);
      out->put((low>>16)&255);
      out->put((low>>8)&255);
      out->put(low&255);
      out->write(&buf[0], low);
      low=0;
    }
    if (c>=0) buf[low++]=c;
  }
}

///////////////////// Compressor //////////////////////

// Write 13 byte start tag
// "\x37\x6B\x53\x74\xA0\x31\x83\xD3\x8C\xB2\x28\xB0\xD3"
void Compressor::writeTag() {
  assert(state==INIT);
  enc.out->put(0x37);
  enc.out->put(0x6b);
  enc.out->put(0x53);
  enc.out->put(0x74);
  enc.out->put(0xa0);
  enc.out->put(0x31);
  enc.out->put(0x83);
  enc.out->put(0xd3);
  enc.out->put(0x8c);
  enc.out->put(0xb2);
  enc.out->put(0x28);
  enc.out->put(0xb0);
  enc.out->put(0xd3);
}

void Compressor::startBlock(int level) {

  // Model 1 - min.cfg
  static const char models[]={
  26,0,1,2,0,0,2,3,16,8,19,0,0,96,4,28,
  59,10,59,112,25,10,59,10,59,112,56,0,

  // Model 2 - mid.cfg
  69,0,3,3,0,0,8,3,5,8,13,0,8,17,1,8,
  18,2,8,18,3,8,19,4,4,22,24,7,16,0,7,24,
  (char)-1,0,17,104,74,4,95,1,59,112,10,25,59,112,10,25,
  59,112,10,25,59,112,10,25,59,112,10,25,59,10,59,112,
  25,69,(char)-49,8,112,56,0,

  // Model 3 - max.cfg
  (char)-60,0,5,9,0,0,22,1,(char)-96,3,5,8,13,1,8,16,
  2,8,18,3,8,19,4,8,19,5,8,20,6,4,22,24,
  3,17,8,19,9,3,13,3,13,3,13,3,14,7,16,0,
  15,24,(char)-1,7,8,0,16,10,(char)-1,6,0,15,16,24,0,9,
  8,17,32,(char)-1,6,8,17,18,16,(char)-1,9,16,19,32,(char)-1,6,
  0,19,20,16,0,0,17,104,74,4,95,2,59,112,10,25,
  59,112,10,25,59,112,10,25,59,112,10,25,59,112,10,25,
  59,10,59,112,10,25,59,112,10,25,69,(char)-73,32,(char)-17,64,47,
  14,(char)-25,91,47,10,25,60,26,48,(char)-122,(char)-105,20,112,63,9,70,
  (char)-33,0,39,3,25,112,26,52,25,25,74,10,4,59,112,25,
  10,4,59,112,25,10,4,59,112,25,65,(char)-113,(char)-44,72,4,59,
  112,8,(char)-113,(char)-40,8,68,(char)-81,60,60,25,69,(char)-49,9,112,25,25,
  25,25,25,112,56,0,

  0,0}; // 0,0 = end of list

  if (level<1) error("compression level must be at least 1");
  const char* p=models;
  int i;
  for (i=1; i<level && toU16(p); ++i)
    p+=toU16(p)+2;
  if (toU16(p)<1) error("compression level too high");
  startBlock(p);
}

// Memory reader
class MemoryReader: public Reader {
  const char* p;
public:
  MemoryReader(const char* p_): p(p_) {}
  int get() {return *p++&255;}
};

// Write a block header
void Compressor::startBlock(const char* hcomp) {
  assert(state==INIT);
  assert(hcomp);
  int len=toU16(hcomp)+2;
  enc.out->put('z');
  enc.out->put('P');
  enc.out->put('Q');
  enc.out->put(1+(len>6 && hcomp[6]==0));  // level 1 or 2
  enc.out->put(1);
  for (int i=0; i<len; ++i)  // write compression model hcomp
    enc.out->put(hcomp[i]);
  MemoryReader m(hcomp);
  z.read(&m);
  state=BLOCK1;
}

// Write a segment header
void Compressor::startSegment(const char* filename, const char* comment) {
  assert(state==BLOCK1 || state==BLOCK2);
  enc.out->put(1);
  while (filename && *filename)
    enc.out->put(*filename++);
  enc.out->put(0);
  while (comment && *comment)
    enc.out->put(*comment++);
  enc.out->put(0);
  enc.out->put(0);
  if (state==BLOCK1) state=SEG1;
  if (state==BLOCK2) state=SEG2;
}

// Initialize encoding and write pcomp to first segment
// If len is 0 then length is encoded in pcomp[0..1]
void Compressor::postProcess(const char* pcomp, int len) {
  assert(state==SEG1);
  enc.init();
  if (pcomp) {
    enc.compress(1);
    if (len<=0) {
      len=toU16(pcomp);
      pcomp+=2;
    }
    enc.compress(len&255);
    enc.compress((len>>8)&255);
    for (int i=0; i<len; ++i)
      enc.compress(pcomp[i]&255);
  }
  else
    enc.compress(0);
  state=SEG2;
}

// Compress n bytes, or to EOF if n <= 0
bool Compressor::compress(int n) {
  assert(state==SEG2);
  int ch=0;
  while (n && (ch=in->get())>=0) {
    enc.compress(ch);
    if (n>0) --n;
  }
  return ch>=0;
}

// End segment, write sha1string if present
void Compressor::endSegment(const char* sha1string) {
  assert(state==SEG2);
  enc.compress(-1);
  enc.out->put(0);
  enc.out->put(0);
  enc.out->put(0);
  enc.out->put(0);
  if (sha1string) {
    enc.out->put(253);
    for (int i=0; i<20; ++i)
      enc.out->put(sha1string[i]);
  }
  else
    enc.out->put(254);
  state=BLOCK2;
}

// End block
void Compressor::endBlock() {
  assert(state==BLOCK2);
  enc.out->put(255);
  state=INIT;
}

/////////////////////////// compress() ///////////////////////

void compress(Reader* in, Writer* out, int level) {
  assert(level>=1);
  Compressor c;
  c.setInput(in);
  c.setOutput(out);
  c.startBlock(level);
  c.startSegment();
  c.postProcess();
  c.compress();
  c.endSegment();
  c.endBlock();
}

//////////////////////// ZPAQL::assemble() ////////////////////

#ifndef NOJIT
/*
assemble();

Assembles the ZPAQL code in hcomp[0..hlen-1] and stores x86-32 or x86-64
code in rcode[0..rcode_size-1]. Execution begins at rcode[0]. It will not
write beyond the end of rcode, but in any case it returns the number of
bytes that would have been written. It returns 0 in case of error.

The assembled code implements run() and returns 1 if successful or
0 if the ZPAQL code executes an invalid instruction or jumps out of
bounds.

A ZPAQL virtual machine has the following state. All values are
unsigned and initially 0:

  a, b, c, d: 32 bit registers (pointed to by their respective parameters)
  f: 1 bit flag register (pointed to)
  r[0..255]: 32 bit registers
  m[0..msize-1]: 8 bit registers, where msize is a power of 2
  h[0..hsize-1]: 32 bit registers, where hsize is a power of 2
  out: pointer to a Writer
  sha1: pointer to a SHA1

Generally a ZPAQL machine is used to compute contexts which are
placed in h. A second machine might post-process, and write its
output to out and sha1. In either case, a machine is called with
its input in a, representing a single byte (0..255) or
(for a postprocessor) EOF (0xffffffff). Execution returs after a
ZPAQL halt instruction.

ZPAQL instructions are 1 byte unless the last 3 bits are 1.
In this case, a second operand byte follows. Opcode 255 is
the only 3 byte instruction. They are organized:

  00dddxxx = unary opcode xxx on destination ddd (ddd < 111)
  00111xxx = special instruction xxx
  01dddsss = assignment: ddd = sss (ddd < 111)
  1xxxxsss = operation sxxx from sss to a

The meaning of sss and ddd are as follows:

  000 = a   (accumulator)
  001 = b
  010 = c
  011 = d
  100 = *b  (means m[b mod msize])
  101 = *c  (means m[c mod msize])
  110 = *d  (means h[d mod hsize])
  111 = n   (constant 0..255 in second byte of instruction)

For example, 01001110 assigns *d to b. The other instructions xxx
are as follows:

Group 00dddxxx where ddd < 111 and xxx is:
  000 = ddd<>a, swap with a (except 00000000 is an error, and swap
        with *b or *c leaves the high bits of a unchanged)
  001 = ddd++, increment
  010 = ddd--, decrement
  011 = ddd!, not (invert all bits)
  100 = ddd=0, clear (set all bits of ddd to 0)
  101 = not used (error)
  110 = not used
  111 = ddd=r n, assign from r[n] to ddd, n=0..255 in next opcode byte
Except:
  00100111 = jt n, jump if f is true (n = -128..127, relative to next opcode)
  00101111 = jf n, jump if f is false (n = -128..127)
  00110111 = r=a n, assign r[n] = a (n = 0..255)

Group 00111xxx where xxx is:
  000 = halt (return)
  001 = output a
  010 = not used
  011 = hash: a = (a + *b + 512) * 773
  100 = hashd: *d = (*d + a + 512) * 773
  101 = not used
  110 = not used
  111 = unconditional jump (n = -128 to 127, relative to next opcode)
  
Group 1xxxxsss where xxxx is:
  0000 = a += sss (add, subtract, multiply, divide sss to a)
  0001 = a -= sss
  0010 = a *= sss
  0011 = a /= sss (unsigned, except set a = 0 if sss is 0)
  0100 = a %= sss (remainder, except set a = 0 if sss is 0)
  0101 = a &= sss (bitwise AND)
  0110 = a &= ~sss (bitwise AND with complement of sss)
  0111 = a |= sss (bitwise OR)
  1000 = a ^= sss (bitwise XOR)
  1001 = a <<= (sss % 32) (left shift by low 5 bits of sss)
  1010 = a >>= (sss % 32) (unsigned, zero bits shifted in)
  1011 = a == sss (compare, set f = true if equal or false otherwise)
  1100 = a < sss (unsigned compare, result in f)
  1101 = a > sss (unsigned compare)
  1110 = not used
  1111 = not used except 11111111 is a 3 byte jump to the absolute address
         in the next 2 bytes in little-endian (LSB first) order.

assemble() translates ZPAQL to 32 bit x86 code to be executed by run().
Registers are mapped as follows:

  eax = source sss from *b, *c, *d or sometimes n
  ecx = pointer to destination *b, *c, *d, or spare
  edx = a
  ebx = f (1 for true, 0 for false)
  esp = stack pointer
  ebp = d
  esi = b
  edi = c

run() saves non-volatile registers (ebp, esi, edi, ebx) on the stack,
loads a, b, c, d, f, and executes the translated instructions.
A halt instruction saves a, b, c, d, f, pops the saved registers
and returns. Invalid instructions or jumps outside of the range
of the ZPAQL code call libzpaq::error().

In 64 bit mode, the following additional registers are used:

  r12 = h
  r14 = r
  r15 = m

*/

// Called by out
static void flush1(ZPAQL* z) {
  z->flush();
}

// return true if op is an undefined ZPAQL instruction
static bool iserr(int op) {
  return op==0 || (op>=120 && op<=127) || (op>=240 && op<=254)
    || op==58 || (op<64 && (op%8==5 || op%8==6));
}

// Write k bytes of x to rcode[o++] MSB first
static void put(U8* rcode, int n, int& o, U32 x, int k) {
  while (k-->0) {
    if (o<n) rcode[o]=(x>>(k*8))&255;
    ++o;
  }
}

// Write 4 bytes of x to rcode[o++] LSB first
static void put4lsb(U8* rcode, int n, int& o, U32 x) {
  for (int k=0; k<4; ++k) {
    if (o<n) rcode[o]=(x>>(k*8))&255;
    ++o;
  }
}

// Write a 1-4 byte x86 opcode without or with an 4 byte operand
// to rcode[o...]
#define put1(x) put(rcode, rcode_size, o, (x), 1)
#define put2(x) put(rcode, rcode_size, o, (x), 2)
#define put3(x) put(rcode, rcode_size, o, (x), 3)
#define put4(x) put(rcode, rcode_size, o, (x), 4)
#define put5(x,y) put4(x), put1(y)
#define put6(x,y) put4(x), put2(y)
#define put4r(x) put4lsb(rcode, rcode_size, o, x)
#define puta(x) t=U32(size_t(x)), put4r(t)
#define put1a(x,y) put1(x), puta(y)
#define put2a(x,y) put2(x), puta(y)
#define put3a(x,y) put3(x), puta(y)
#define put4a(x,y) put4(x), puta(y)
#define put5a(x,y,z) put4(x), put1(y), puta(z)
#define put2l(x,y) put2(x), t=U32(size_t(y)), put4r(t), \
  t=U32(size_t(y)>>(S*4)), put4r(t)

// Assemble ZPAQL in in the HCOMP section of header to rcode,
// but do not write beyond rcode_size. Return the number of
// bytes output or that would have been output.
// Execution starts at rcode[0] and returns 1 if successful or 0
// in case of a ZPAQL execution error.
int ZPAQL::assemble() {

  // x86? (not foolproof)
  const int S=sizeof(char*);      // 4 = x86, 8 = x86-64
  U32 t=0x12345678;
  if (*(char*)&t!=0x78 || (S!=4 && S!=8))
    error("JIT supported only for x86-32 and x86-64");

  const U8* hcomp=&header[hbegin];
  const int hlen=hend-hbegin+1;
  const int msize=m.size();
  const int hsize=h.size();
  const int regcode[8]={2,6,7,5}; // a,b,c,d.. -> edx,esi,edi,ebp,eax..
  Array<int> it(hlen);            // hcomp -> rcode locations
  int done=0;  // number of instructions assembled (0..hlen)
  int o=5;  // rcode output index, reserve space for jmp

  // Code for the halt instruction (restore registers and return)
  const int halt=o;
  if (S==8) {
    put2l(0x48b9, &a);        // mov rcx, a
    put2(0x8911);             // mov [rcx], edx
    put2l(0x48b9, &b);        // mov rcx, b
    put2(0x8931);             // mov [rcx], esi
    put2l(0x48b9, &c);        // mov rcx, c
    put2(0x8939);             // mov [rcx], edi
    put2l(0x48b9, &d);        // mov rcx, d
    put2(0x8929);             // mov [rcx], ebp
    put2l(0x48b9, &f);        // mov rcx, f
    put2(0x8919);             // mov [rcx], ebx
    put4(0x4883c438);         // add rsp, 56
    put2(0x415f);             // pop r15
    put2(0x415e);             // pop r14
    put2(0x415d);             // pop r13
    put2(0x415c);             // pop r12
  }
  else {
    put2a(0x8915, &a);        // mov [a], edx
    put2a(0x8935, &b);        // mov [b], esi
    put2a(0x893d, &c);        // mov [c], edi
    put2a(0x892d, &d);        // mov [d], ebp
    put2a(0x891d, &f);        // mov [f], ebx
    put3(0x83c43c);           // add esp, 60
  }
  put1(0x5d);                 // pop ebp
  put1(0x5b);                 // pop ebx
  put1(0x5f);                 // pop edi
  put1(0x5e);                 // pop esi
  put1(0xc3);                 // ret

  // Code for the out instruction.
  // Store a=edx at outbuf[bufptr++]. If full, call flush1().
  const int outlabel=o;
  if (S==8) {
    put2l(0x48b8, &outbuf[0]);// mov rax, outbuf.p
    put2l(0x49ba, &bufptr);   // mov r10, &bufptr
    put3(0x418b0a);           // mov ecx, [r10]
    put3(0x891408);           // mov [rax+rcx], edx
    put2(0xffc1);             // inc ecx
    put3(0x41890a);           // mov [r10], ecx
    put2a(0x81f9, outbuf.size());  // cmp ecx, outbuf.size()
    put2(0x7401);             // jz L1
    put1(0xc3);               // ret
    put4(0x4883ec30);         // L1: sub esp, 48  ; call flush1(this)
    put4(0x48893c24);         // mov [rsp], rdi
    put5(0x48897424,8);       // mov [rsp+8], rsi
    put5(0x48895424,16);      // mov [rsp+16], rdx
    put5(0x48894c24,24);      // mov [rsp+24], rcx
#ifndef _WIN32
    put2l(0x48bf, this);      // mov rdi, this
#else  // Windows
    put2l(0x48b9, this);      // mov rcx, this
#endif
    put2l(0x49bb, &flush1);   // mov r11, &flush1
    put3(0x41ffd3);           // call r11
    put5(0x488b4c24,24);      // mov rcx, [rsp+24]
    put5(0x488b5424,16);      // mov rdx, [rsp+16]
    put5(0x488b7424,8);       // mov rsi, [rsp+8]
    put4(0x488b3c24);         // mov rdi, [rsp]
    put4(0x4883c430);         // add esp, 48
    put1(0xc3);               // ret
  }
  else {
    put1a(0xb8, &outbuf[0]);  // mov eax, outbuf.p
    put2a(0x8b0d, &bufptr);   // mov ecx, [bufptr]
    put3(0x891408);           // mov [eax+ecx], edx
    put2(0xffc1);             // inc ecx
    put2a(0x890d, &bufptr);   // mov [bufptr], ecx
    put2a(0x81f9, outbuf.size());  // cmp ecx, outbuf.size()
    put2(0x7401);             // jz L1
    put1(0xc3);               // ret
    put3(0x83ec08);           // L1: sub esp, 8
    put4(0x89542404);         // mov [esp+4], edx
    put3a(0xc70424, this);    // mov [esp], this
    put1a(0xb8, &flush1);     // mov eax, &flush1
    put2(0xffd0);             // call eax
    put4(0x8b542404);         // mov edx, [esp+4]
    put3(0x83c408);           // add esp, 8
    put1(0xc3);               // ret
  }

  // Set it[i]=1 for each ZPAQL instruction reachable from the previous
  // instruction + 2 if reachable by a jump (or 3 if both).
  it[0]=2;
  assert(hlen>0 && hcomp[hlen-1]==0);  // ends with error
  do {
    done=0;
    const int NONE=0x80000000;
    for (int i=0; i<hlen; ++i) {
      int op=hcomp[i];
      if (it[i]) {
        int next1=i+1+(op%8==7), next2=NONE; // next and jump targets
        if (iserr(op)) next1=NONE;  // error
        if (op==56) next1=NONE, next2=0;  // halt
        if (op==255) next1=NONE, next2=hcomp[i+1]+256*hcomp[i+2]; // lj
        if (op==39||op==47||op==63)next2=i+2+(hcomp[i+1]<<24>>24);// jt,jf,jmp
        if (op==63) next1=NONE;  // jmp
        if ((next2<0 || next2>=hlen) && next2!=NONE) next2=hlen-1; // error
        if (next1!=NONE && !(it[next1]&1)) it[next1]|=1, ++done;
        if (next2!=NONE && !(it[next2]&2)) it[next2]|=2, ++done;
      }
    }
  } while (done>0);

  // Set it[i] bits 2-3 to 4, 8, or 12 if a comparison
  //  (<, >, == respectively) does not need to save the result in f,
  // or if a conditional jump (jt, jf) does not need to read f.
  // This is true if a comparison is followed directly by a jt/jf,
  // the jt/jf is not a jump target, the byte before is not a jump
  // target (for a 2 byte comparison), and for the comparison instruction
  // if both paths after the jt/jf lead to another comparison or error
  // before another jt/jf. At most hlen steps are traced because after
  // that it must be an infinite loop.
  for (int i=0; i<hlen; ++i) {
    const int op1=hcomp[i]; // 216..239 = comparison
    const int i2=i+1+(op1%8==7);  // address of next instruction
    const int op2=hcomp[i2];  // 39,47 = jt,jf
    if (it[i] && op1>=216 && op1<240 && (op2==39 || op2==47)
        && it[i2]==1 && (i2==i+1 || it[i+1]==0)) {
      int code=(op1-208)/8*4; // 4,8,12 is ==,<,>
      it[i2]+=code;  // OK to test CF, ZF instead of f
      for (int j=0; j<2 && code; ++j) {  // trace each path from i2
        int k=i2+2; // branch not taken
        if (j==1) k=i2+2+(hcomp[i2+1]<<24>>24);  // branch taken
        for (int l=0; l<hlen && code; ++l) {  // trace at most hlen steps
          if (k<0 || k>=hlen) break;  // out of bounds, pass
          const int op=hcomp[k];
          if (op==39 || op==47) code=0;  // jt,jf, fail
          else if (op>=216 && op<240) break;  // ==,<,>, pass
          else if (iserr(op)) break;  // error, pass
          else if (op==255) k=hcomp[k+1]+256*hcomp[k+2]; // lj
          else if (op==63) k=k+2+(hcomp[k+1]<<24>>24);  // jmp
          else if (op==56) k=0;  // halt
          else k=k+1+(op%8==7);  // ordinary instruction
        }
      }
      it[i]+=code;  // if > 0 then OK to not save flags in f (bl)
    }
  }

  // Start of run(): Save x86 and load ZPAQL registers
  const int start=o;
  assert(start>=16);
  put1(0x56);          // push esi/rsi
  put1(0x57);          // push edi/rdi
  put1(0x53);          // push ebx/rbx
  put1(0x55);          // push ebp/rbp
  if (S==8) {
    put2(0x4154);      // push r12
    put2(0x4155);      // push r13
    put2(0x4156);      // push r14
    put2(0x4157);      // push r15
    put4(0x4883ec38);  // sub rsp, 56
    put2l(0x48b8, &a); // mov rax, a
    put2(0x8b10);      // mov edx, [rax]
    put2l(0x48b8, &b); // mov rax, b
    put2(0x8b30);      // mov esi, [rax]
    put2l(0x48b8, &c); // mov rax, c
    put2(0x8b38);      // mov edi, [rax]
    put2l(0x48b8, &d); // mov rax, d
    put2(0x8b28);      // mov ebp, [rax]
    put2l(0x48b8, &f); // mov rax, f
    put2(0x8b18);      // mov ebx, [rax]
    put2l(0x49bc, &h[0]);   // mov r12, h
    put2l(0x49bd, &outbuf[0]); // mov r13, outbuf.p
    put2l(0x49be, &r[0]);   // mov r14, r
    put2l(0x49bf, &m[0]);   // mov r15, m
  }
  else {
    put3(0x83ec3c);    // sub esp, 60
    put2a(0x8b15, &a); // mov edx, [a]
    put2a(0x8b35, &b); // mov esi, [b]
    put2a(0x8b3d, &c); // mov edi, [c]
    put2a(0x8b2d, &d); // mov ebp, [d]
    put2a(0x8b1d, &f); // mov ebx, [f]
  }

  // Assemble in multiple passes until every byte of hcomp has a translation
  for (int istart=0; istart<hlen; ++istart) {
    for (int i=istart; i<hlen&&it[i]; i=i+1+(hcomp[i]%8==7)+(hcomp[i]==255)) {
      const int code=it[i];

      // If already assembled, then assemble a jump to it
      U32 t;
      assert(it.isize()>i);
      assert(i>=0 && i<hlen);
      if (code>=16) {
        if (i>istart) {
          int a=code-o;
          if (a>-120 && a<120)
            put2(0xeb00+((a-2)&255)); // jmp short o
          else
            put1a(0xe9, a-5);  // jmp near o
        }
        break;
      }

      // Else assemble the instruction at hcode[i] to rcode[o]
      else {
        assert(i>=0 && i<it.isize());
        assert(it[i]>0 && it[i]<16);
        assert(o>=16);
        it[i]=o;
        ++done;
        const int op=hcomp[i];
        const int arg=hcomp[i+1]+((op==255)?256*hcomp[i+2]:0);
        const int ddd=op/8%8;
        const int sss=op%8;

        // error instruction: return 0
        if (iserr(op)) {
          put2(0x31c0);           // xor eax, eax
          put1a(0xe9, halt-o-4);  // jmp near halt
          continue;
        }

        // Load source *b, *c, *d, or hash (*b) into eax except:
        // {a,b,c,d}=*d, a{+,-,*,&,|,^,=,==,>,>}=*d: load address to eax
        // {a,b,c,d}={*b,*c}: load source into ddd
        if (op==59 || (op>=64 && op<240 && op%8>=4 && op%8<7)) {
          put2(0x89c0+8*regcode[sss-3+(op==59)]);  // mov eax, {esi,edi,ebp}
          const int sz=(sss==6?hsize:msize)-1;
          if (sz>=128) put1a(0x25, sz);            // and eax, dword msize-1
          else put3(0x83e000+sz);                  // and eax, byte msize-1
          const int move=(op>=64 && op<112); // = or else ddd is eax
          if (sss<6) { // ddd={a,b,c,d,*b,*c}
            if (S==8) put5(0x410fb604+8*move*regcode[ddd],0x07);
                                                   // movzx ddd, byte [r15+rax]
            else put3a(0x0fb680+8*move*regcode[ddd], &m[0]);
                                                   // movzx ddd, byte [m+eax]
          }
          else if ((0x06587000>>(op/8))&1) {// {*b,*c,*d,a/,a%,a&~,a<<,a>>}=*d
            if (S==8) put4(0x418b0484);            // mov eax, [r12+rax*4]
            else put3a(0x8b0485, &h[0]);           // mov eax, [h+eax*4]
          }
        }

        // Load destination address *b, *c, *d or hashd (*d) into ecx
        if ((op>=32 && op<56 && op%8<5) || (op>=96 && op<120) || op==60) {
          put2(0x89c1+8*regcode[op/8%8-3-(op==60)]);// mov ecx,{esi,edi,ebp}
          const int sz=(ddd==6||op==60?hsize:msize)-1;
          if (sz>=128) put2a(0x81e1, sz);   // and ecx, dword sz
          else put3(0x83e100+sz);           // and ecx, byte sz
          if (op/8%8==6 || op==60) { // *d
            if (S==8) put4(0x498d0c8c);     // lea rcx, [r12+rcx*4]
            else put3a(0x8d0c8d, &h[0]);    // lea ecx, [ecx*4+h]
          }
          else { // *b, *c
            if (S==8) put4(0x498d0c0f);     // lea rcx, [r15+rcx]
            else put2a(0x8d89, &m[0]);      // lea ecx, [ecx+h]
          }
        }

        // Translate by opcode
        switch((op/8)&31) {
          case 0:  // ddd = a
          case 1:  // ddd = b
          case 2:  // ddd = c
          case 3:  // ddd = d
            switch(sss) {
              case 0:  // ddd<>a (swap)
                put2(0x87d0+regcode[ddd]);   // xchg edx, ddd
                break;
              case 1:  // ddd++
                put2(0xffc0+regcode[ddd]);   // inc ddd
                break;
              case 2:  // ddd--
                put2(0xffc8+regcode[ddd]);   // dec ddd
                break;
              case 3:  // ddd!
                put2(0xf7d0+regcode[ddd]);   // not ddd
                break;
              case 4:  // ddd=0
                put2(0x31c0+9*regcode[ddd]); // xor ddd,ddd
                break;
              case 7:  // ddd=r n
                if (S==8)
                  put3a(0x418b86+8*regcode[ddd], arg*4); // mov ddd, [r14+n*4]
                else
                  put2a(0x8b05+8*regcode[ddd], (&r[arg]));//mov ddd, [r+n]
                break;
            }
            break;
          case 4:  // ddd = *b
          case 5:  // ddd = *c
            switch(sss) {
              case 0:  // ddd<>a (swap)
                put2(0x8611);                // xchg dl, [ecx]
                break;
              case 1:  // ddd++
                put2(0xfe01);                // inc byte [ecx]
                break;
              case 2:  // ddd--
                put2(0xfe09);                // dec byte [ecx]
                break;
              case 3:  // ddd!
                put2(0xf611);                // not byte [ecx]
                break;
              case 4:  // ddd=0
                put2(0x31c0);                // xor eax, eax
                put2(0x8801);                // mov [ecx], al
                break;
              case 7:  // jt, jf
              {
                assert(code>=0 && code<16);
                const int jtab[2][4]={{5,4,2,7},{4,5,3,6}};
                               // jnz,je,jb,ja, jz,jne,jae,jbe
                if (code<4) put2(0x84db);    // test bl, bl
                if (arg>=128 && arg-257-i>=0 && o-it[arg-257-i]<120)
                  put2(0x7000+256*jtab[op==47][code/4]); // jx short 0
                else
                  put2a(0x0f80+jtab[op==47][code/4], 0); // jx near 0
                break;
              }
            }
            break;
          case 6:  // ddd = *d
            switch(sss) {
              case 0:  // ddd<>a (swap)
                put2(0x8711);             // xchg edx, [ecx]
                break;
              case 1:  // ddd++
                put2(0xff01);             // inc dword [ecx]
                break;
              case 2:  // ddd--
                put2(0xff09);             // dec dword [ecx]
                break;
              case 3:  // ddd!
                put2(0xf711);             // not dword [ecx]
                break;
              case 4:  // ddd=0
                put2(0x31c0);             // xor eax, eax
                put2(0x8901);             // mov [ecx], eax
                break;
              case 7:  // ddd=r n
                if (S==8)
                  put3a(0x418996, arg*4); // mov [r14+n*4], edx
                else
                  put2a(0x8915, &r[arg]); // mov [r+n], edx
                break;
            }
            break;
          case 7:  // special
            switch(op) {
              case 56: // halt
                put1a(0xb8, 1);           // mov eax, 1
                put1a(0xe9, halt-o-4);    // jmp near halt
                break;
              case 57:  // out
                put1a(0xe8, outlabel-o-4);// call outlabel
                break;
              case 59:  // hash: a = (a + *b + 512) * 773
                put3a(0x8d8410, 512);     // lea edx, [eax+edx+512]
                put2a(0x69d0, 773);       // imul edx, eax, 773
                break;
              case 60:  // hashd: *d = (*d + a + 512) * 773
                put2(0x8b01);             // mov eax, [ecx]
                put3a(0x8d8410, 512);     // lea eax, [eax+edx+512]
                put2a(0x69c0, 773);       // imul eax, eax, 773
                put2(0x8901);             // mov [ecx], eax
                break;
              case 63:  // jmp
                put1a(0xe9, 0);           // jmp near 0 (fill in target later)
                break;
            }
            break;
          case 8:   // a=
          case 9:   // b=
          case 10:  // c=
          case 11:  // d=
            if (sss==7)  // n
              put1a(0xb8+regcode[ddd], arg);         // mov ddd, n
            else if (sss==6) { // *d
              if (S==8)
                put4(0x418b0484+(regcode[ddd]<<11)); // mov ddd, [r12+rax*4]
              else
                put3a(0x8b0485+(regcode[ddd]<<11),&h[0]);// mov ddd, [h+eax*4]
            }
            else if (sss<4) // a, b, c, d
              put2(0x89c0+regcode[ddd]+8*regcode[sss]);// mov ddd,sss
            break;
          case 12:  // *b=
          case 13:  // *c=
            if (sss==7) put3(0xc60100+arg);          // mov byte [ecx], n
            else if (sss==0) put2(0x8811);           // mov byte [ecx], dl
            else {
              if (sss<4) put2(0x89c0+8*regcode[sss]);// mov eax, sss
              put2(0x8801);                          // mov byte [ecx], al
            }
            break;
          case 14:  // *d=
            if (sss<7) put2(0x8901+8*regcode[sss]);  // mov [ecx], sss
            else put2a(0xc701, arg);                 // mov dword [ecx], n
            break;
          case 15: break; // not used
          case 16:  // a+=
            if (sss==6) {
              if (S==8) put4(0x41031484);            // add edx, [r12+rax*4]
              else put3a(0x031485, &h[0]);           // add edx, [h+eax*4]
            }
            else if (sss<7) put2(0x01c2+8*regcode[sss]);// add edx, sss
            else if (arg>128) put2a(0x81c2, arg);    // add edx, n
            else put3(0x83c200+arg);                 // add edx, byte n
            break;
          case 17:  // a-=
            if (sss==6) {
              if (S==8) put4(0x412b1484);            // sub edx, [r12+rax*4]
              else put3a(0x2b1485, &h[0]);           // sub edx, [h+eax*4]
            }
            else if (sss<7) put2(0x29c2+8*regcode[sss]);// sub edx, sss
            else if (arg>=128) put2a(0x81ea, arg);   // sub edx, n
            else put3(0x83ea00+arg);                 // sub edx, byte n
            break;
          case 18:  // a*=
            if (sss==6) {
              if (S==8) put5(0x410faf14,0x84);       // imul edx, [r12+rax*4]
              else put4a(0x0faf1485, &h[0]);         // imul edx, [h+eax*4]
            }
            else if (sss<7) put3(0x0fafd0+regcode[sss]);// imul edx, sss
            else if (arg>=128) put2a(0x69d2, arg);   // imul edx, n
            else put3(0x6bd200+arg);                 // imul edx, byte n
            break;
          case 19:  // a/=
          case 20:  // a%=
            if (sss<7) put2(0x89c1+8*regcode[sss]);  // mov ecx, sss
            else put1a(0xb9, arg);                   // mov ecx, n
            put2(0x85c9);                            // test ecx, ecx
            put3(0x0f44d1);                          // cmovz edx, ecx
            put2(0x7408-2*(op/8==20));               // jz (over rest)
            put2(0x89d0);                            // mov eax, edx
            put2(0x31d2);                            // xor edx, edx
            put2(0xf7f1);                            // div ecx
            if (op/8==19) put2(0x89c2);              // mov edx, eax
            break;
          case 21:  // a&=
            if (sss==6) {
              if (S==8) put4(0x41231484);            // and edx, [r12+rax*4]
              else put3a(0x231485, &h[0]);           // and edx, [h+eax*4]
            }
            else if (sss<7) put2(0x21c2+8*regcode[sss]);// and edx, sss
            else if (arg>=128) put2a(0x81e2, arg);   // and edx, n
            else put3(0x83e200+arg);                 // and edx, byte n
            break;
          case 22:  // a&~
            if (sss==7) {
              if (arg<128) put3(0x83e200+(~arg&255));// and edx, byte ~n
              else put2a(0x81e2, ~arg);              // and edx, ~n
            }
            else {
              if (sss<4) put2(0x89c0+8*regcode[sss]);// mov eax, sss
              put2(0xf7d0);                          // not eax
              put2(0x21c2);                          // and edx, eax
            }
            break;
          case 23:  // a|=
            if (sss==6) {
              if (S==8) put4(0x410b1484);            // or edx, [r12+rax*4]
              else put3a(0x0b1485, &h[0]);           // or edx, [h+eax*4]
            }
            else if (sss<7) put2(0x09c2+8*regcode[sss]);// or edx, sss
            else if (arg>=128) put2a(0x81ca, arg);   // or edx, n
            else put3(0x83ca00+arg);                 // or edx, byte n
            break;
          case 24:  // a^=
            if (sss==6) {
              if (S==8) put4(0x41331484);            // xor edx, [r12+rax*4]
              else put3a(0x331485, &h[0]);           // xor edx, [h+eax*4]
            }
            else if (sss<7) put2(0x31c2+8*regcode[sss]);// xor edx, sss
            else if (arg>=128) put2a(0x81f2, arg);   // xor edx, byte n
            else put3(0x83f200+arg);                 // xor edx, n
            break;
          case 25:  // a<<=
          case 26:  // a>>=
            if (sss==7)  // sss = n
              put3(0xc1e200+8*256*(op/8==26)+arg);   // shl/shr n
            else {
              put2(0x89c1+8*regcode[sss]);           // mov ecx, sss
              put2(0xd3e2+8*(op/8==26));             // shl/shr edx, cl
            }
            break;
          case 27:  // a==
          case 28:  // a<
          case 29:  // a>
            if (sss==6) {
              if (S==8) put4(0x413b1484);            // cmp edx, [r12+rax*4]
              else put3a(0x3b1485, &h[0]);           // cmp edx, [h+eax*4]
            }
            else if (sss==7)  // sss = n
              put2a(0x81fa, arg);                    // cmp edx, dword n
            else
              put2(0x39c2+8*regcode[sss]);           // cmp edx, sss
            if (code<4) {
              if (op/8==27) put3(0x0f94c3);          // setz bl
              if (op/8==28) put3(0x0f92c3);          // setc bl
              if (op/8==29) put3(0x0f97c3);          // seta bl
            }
            break;
          case 30:  // not used
          case 31:  // 255 = lj
            if (op==255) put1a(0xe9, 0);             // jmp near
            break;
        }
      }
    }
  }

  // Finish first pass
  const int rsize=o;
  if (o>rcode_size) return rsize;

  // Fill in jump addresses (second pass)
  for (int i=0; i<hlen; ++i) {
    if (it[i]<16) continue;
    int op=hcomp[i];
    if (op==39 || op==47 || op==63 || op==255) {  // jt, jf, jmp, lj
      int target=hcomp[i+1];
      if (op==255) target+=hcomp[i+2]*256;  // lj
      else {
        if (target>=128) target-=256;
        target+=i+2;
      }
      if (target<0 || target>=hlen) target=hlen-1;  // runtime ZPAQL error
      o=it[i];
      assert(o>=16 && o<rcode_size);
      if ((op==39 || op==47) && rcode[o]==0x84) o+=2;  // jt, jf -> skip test
      assert(o>=16 && o<rcode_size);
      if (rcode[o]==0x0f) ++o;  // first byte of jz near, jnz near
      assert(o<rcode_size);
      op=rcode[o++];  // x86 opcode
      target=it[target]-o;
      if ((op>=0x72 && op<0x78) || op==0xeb) {  // jx, jmp short
        --target;
        if (target<-128 || target>127)
          error("Cannot code x86 short jump");
        assert(o<rcode_size);
        rcode[o]=target&255;
      }
      else if ((op>=0x82 && op<0x88) || op==0xe9) // jx, jmp near
      {
        target-=4;
        puta(target);
      }
      else assert(false);  // not a x86 jump
    }
  }

  // Jump to start
  o=0;
  put1a(0xe9, start-5);  // jmp near start
  return rsize;
}

//////////////////////// Predictor::assemble_p() /////////////////////

// Assemble the ZPAQL code in the HCOMP section of z.header to pcomp and
// return the number of bytes of x86 or x86-64 code written, or that would
// be written if pcomp were large enough. The code for predict() begins
// at pr.pcomp[0] and update() at pr.pcomp[5], both as jmp instructions.

// The assembled code is equivalent to int predict(Predictor*)
// and void update(Predictor*, int y); The Preditor address is placed in
// edi/rdi. The update bit y is placed in ebp/rbp.

int Predictor::assemble_p() {
  Predictor& pr=*this;
  U8* rcode=pr.pcode;         // x86 output array
  int rcode_size=pcode_size;  // output size
  int o=0;                    // output index in pcode
  const int S=sizeof(char*);  // 4 or 8
  U8* hcomp=&pr.z.header[0];  // The code to translate
#define off(x)  ((char*)&(pr.x)-(char*)&pr)
#define offc(x) ((char*)&(pr.comp[i].x)-(char*)&pr)

  // test for little-endian (probably x86)
  U32 t=0x12345678;
  if (*(char*)&t!=0x78 || (S!=4 && S!=8))
    error("JIT supported only for x86-32 and x86-64");

  // Initialize for predict(). Put predictor address in edi/rdi
  put1a(0xe9, 5);             // jmp predict
  put1a(0, 0x90909000);       // reserve space for jmp update
  put1(0x53);                 // push ebx/rbx
  put1(0x55);                 // push ebp/rbp
  put1(0x56);                 // push esi/rsi
  put1(0x57);                 // push edi/rdi
  if (S==4)
    put4(0x8b7c2414);         // mov edi,[esp+0x14] ; pr
  else {
#ifdef _WIN32
    put3(0x4889cf);           // mov rdi, rcx (1st arg in Win64)
#endif
  }

  // Code predict() for each component
  const int n=hcomp[6];  // number of components
  U8* cp=hcomp+7;
  for (int i=0; i<n; ++i, cp+=compsize[cp[0]]) {
    if (cp-hcomp>=pr.z.cend) error("comp too big");
    if (cp[0]<1 || cp[0]>9) error("invalid component");
    assert(compsize[cp[0]]>0 && compsize[cp[0]]<8);
    switch (cp[0]) {

      case CONS:  // c
        break;

      case CM:  // sizebits limit
        // Component& cr=comp[i];
        // cr.cxt=h[i]^hmap4;
        // p[i]=stretch(cr.cm(cr.cxt)>>17);

        put2a(0x8b87, off(h[i]));              // mov eax, [edi+&h[i]]
        put2a(0x3387, off(hmap4));             // xor eax, [edi+&hmap4]
        put1a(0x25, (1<<cp[1])-1);             // and eax, size-1
        put2a(0x8987, offc(cxt));              // mov [edi+cxt], eax
        if (S==8) put1(0x48);                  // rex.w (esi->rsi)
        put2a(0x8bb7, offc(cm));               // mov esi, [edi+&cm]
        put3(0x8b0486);                        // mov eax, [esi+eax*4]
        put3(0xc1e811);                        // shr eax, 17
        put4a(0x0fbf8447, off(stretcht));      // movsx eax,word[edi+eax*2+..]
        put2a(0x8987, off(p[i]));              // mov [edi+&p[i]], eax
        break;

      case ISSE:  // sizebits j -- c=hi, cxt=bh
        // assert((hmap4&15)>0);
        // if (c8==1 || (c8&0xf0)==16)
        //   cr.c=find(cr.ht, cp[1]+2, h[i]+16*c8);
        // cr.cxt=cr.ht[cr.c+(hmap4&15)];  // bit history
        // int *wt=(int*)&cr.cm[cr.cxt*2];
        // p[i]=clamp2k((wt[0]*p[cp[2]]+wt[1]*64)>>16);

      case ICM: // sizebits
        // assert((hmap4&15)>0);
        // if (c8==1 || (c8&0xf0)==16) cr.c=find(cr.ht, cp[1]+2, h[i]+16*c8);
        // cr.cxt=cr.ht[cr.c+(hmap4&15)];
        // p[i]=stretch(cr.cm(cr.cxt)>>8);
        //
        // Find cxt row in hash table ht. ht has rows of 16 indexed by the low
        // sizebits of cxt with element 0 having the next higher 8 bits for
        // collision detection. If not found after 3 adjacent tries, replace
        // row with lowest element 1 as priority. Return index of row.
        //
        // size_t Predictor::find(Array<U8>& ht, int sizebits, U32 cxt) {
        //  assert(ht.size()==size_t(16)<<sizebits);
        //  int chk=cxt>>sizebits&255;
        //  size_t h0=(cxt*16)&(ht.size()-16);
        //  if (ht[h0]==chk) return h0;
        //  size_t h1=h0^16;
        //  if (ht[h1]==chk) return h1;
        //  size_t h2=h0^32;
        //  if (ht[h2]==chk) return h2;
        //  if (ht[h0+1]<=ht[h1+1] && ht[h0+1]<=ht[h2+1])
        //    return memset(&ht[h0], 0, 16), ht[h0]=chk, h0;
        //  else if (ht[h1+1]<ht[h2+1])
        //    return memset(&ht[h1], 0, 16), ht[h1]=chk, h1;
        //  else
        //    return memset(&ht[h2], 0, 16), ht[h2]=chk, h2;
        // }

        if (S==8) put1(0x48);                  // rex.w
        put2a(0x8bb7, offc(ht));               // mov esi, [edi+&ht]
        put2(0x8b07);                          // mov eax, edi ; c8
        put2(0x89c1);                          // mov ecx, eax ; c8
        put3(0x83f801);                        // cmp eax, 1
        put2(0x740a);                          // je L1
        put1a(0x25, 240);                      // and eax, 0xf0
        put3(0x83f810);                        // cmp eax, 16
        put2(0x7576);                          // jne L2 ; skip find()
           // L1: ; find cxt in ht, return index in eax
        put3(0xc1e104);                        // shl ecx, 4
        put2a(0x038f, off(h[i]));              // add [edi+&h[i]]
        put2(0x89c8);                          // mov eax, ecx ; cxt
        put3(0xc1e902+cp[1]);                  // shr ecx, sizebits+2
        put2a(0x81e1, 255);                    // and eax, 255 ; chk
        put3(0xc1e004);                        // shl eax, 4
        put1a(0x25, (64<<cp[1])-16);           // and eax, ht.size()-16 = h0
        put3(0x3a0c06);                        // cmp cl, [esi+eax] ; ht[h0]
        put2(0x744d);                          // je L3 ; match h0
        put3(0x83f010);                        // xor eax, 16 ; h1
        put3(0x3a0c06);                        // cmp cl, [esi+eax]
        put2(0x7445);                          // je L3 ; match h1
        put3(0x83f030);                        // xor eax, 48 ; h2
        put3(0x3a0c06);                        // cmp cl, [esi+eax]
        put2(0x743d);                          // je L3 ; match h2
          // No checksum match, so replace the lowest priority among h0,h1,h2
        put3(0x83f021);                        // xor eax, 33 ; h0+1
        put3(0x8a1c06);                        // mov bl, [esi+eax] ; ht[h0+1]
        put2(0x89c2);                          // mov edx, eax ; h0+1
        put3(0x83f220);                        // xor edx, 32  ; h2+1
        put3(0x3a1c16);                        // cmp bl, [esi+edx]
        put2(0x7708);                          // ja L4 ; test h1 vs h2
        put3(0x83f230);                        // xor edx, 48  ; h1+1
        put3(0x3a1c16);                        // cmp bl, [esi+edx]
        put2(0x7611);                          // jbe L7 ; replace h0
          // L4: ; h0 is not lowest, so replace h1 or h2
        put3(0x83f010);                        // xor eax, 16 ; h1+1
        put3(0x8a1c06);                        // mov bl, [esi+eax]
        put3(0x83f030);                        // xor eax, 48 ; h2+1
        put3(0x3a1c06);                        // cmp bl, [esi+eax]
        put2(0x7303);                          // jae L7
        put3(0x83f030);                        // xor eax, 48 ; h1+1
          // L7: ; replace row pointed to by eax = h0,h1,h2
        put3(0x83f001);                        // xor eax, 1
        put3(0x890c06);                        // mov [esi+eax], ecx ; chk
        put2(0x31c9);                          // xor ecx, ecx
        put4(0x894c0604);                      // mov [esi+eax+4], ecx
        put4(0x894c0608);                      // mov [esi+eax+8], ecx
        put4(0x894c060c);                      // mov [esi+eax+12], ecx
          // L3: ; save nibble context (in eax) in c
        put2a(0x8987, offc(c));                // mov [edi+c], eax
        put2(0xeb06);                          // jmp L8
          // L2: ; get nibble context
        put2a(0x8b87, offc(c));                // mov eax, [edi+c]
          // L8: ; nibble context is in eax
        put2a(0x8b97, off(hmap4));             // mov edx, [edi+&hmap4]
        put3(0x83e20f);                        // and edx, 15  ; hmap4
        put2(0x01d0);                          // add eax, edx ; c+(hmap4&15)
        put4(0x0fb61406);                      // movzx edx, byte [esi+eax]
        put2a(0x8997, offc(cxt));              // mov [edi+&cxt], edx ; cxt=bh
        if (S==8) put1(0x48);                  // rex.w
        put2a(0x8bb7, offc(cm));               // mov esi, [edi+&cm] ; cm

        // esi points to cm[256] (ICM) or cm[512] (ISSE) with 23 bit
        // prediction (ICM) or a pair of 20 bit signed weights (ISSE).
        // cxt = bit history bh (0..255) is in edx.
        if (cp[0]==ICM) {
          put3(0x8b0496);                      // mov eax, [esi+edx*4];cm[bh]
          put3(0xc1e808);                      // shr eax, 8
          put4a(0x0fbf8447, off(stretcht));    // movsx eax,word[edi+eax*2+..]
        }
        else {  // ISSE
          put2a(0x8b87, off(p[cp[2]]));        // mov eax, [edi+&p[j]]
          put4(0x0faf04d6);                    // imul eax, [esi+edx*8] ;wt[0]
          put4(0x8b4cd604);                    // mov ecx, [esi+edx*8+4];wt[1]
          put3(0xc1e106);                      // shl ecx, 6
          put2(0x01c8);                        // add eax, ecx
          put3(0xc1f810);                      // sar eax, 16
          put1a(0xb9, 2047);                   // mov ecx, 2047
          put2(0x39c8);                        // cmp eax, ecx
          put3(0x0f4fc1);                      // cmovg eax, ecx
          put1a(0xb9, -2048);                  // mov ecx, -2048
          put2(0x39c8);                        // cmp eax, ecx
          put3(0x0f4cc1);                      // cmovl eax, ecx

        }
        put2a(0x8987, off(p[i]));              // mov [edi+&p[i]], eax
        break;

      case MATCH: // sizebits bufbits: a=len, b=offset, c=bit, cxt=bitpos,
                  //                   ht=buf, limit=pos
        // assert(cr.cm.size()==(size_t(1)<<cp[1]));
        // assert(cr.ht.size()==(size_t(1)<<cp[2]));
        // assert(cr.a<=255);
        // assert(cr.c==0 || cr.c==1);
        // assert(cr.cxt<8);
        // assert(cr.limit<cr.ht.size());
        // if (cr.a==0) p[i]=0;
        // else {
        //   cr.c=(cr.ht(cr.limit-cr.b)>>(7-cr.cxt))&1; // predicted bit
        //   p[i]=stretch(dt2k[cr.a]*(cr.c*-2+1)&32767);
        // }

        if (S==8) put1(0x48);          // rex.w
        put2a(0x8bb7, offc(ht));       // mov esi, [edi+&ht]

        // If match length (a) is 0 then p[i]=0
        put2a(0x8b87, offc(a));        // mov eax, [edi+&a]
        put2(0x85c0);                  // test eax, eax
        put2(0x7449);                  // jz L2 ; p[i]=0

        // Else put predicted bit in c
        put1a(0xb9, 7);                // mov ecx, 7
        put2a(0x2b8f, offc(cxt));      // sub ecx, [edi+&cxt]
        put2a(0x8b87, offc(limit));    // mov eax, [edi+&limit]
        put2a(0x2b87, offc(b));        // sub eax, [edi+&b]
        put1a(0x25, (1<<cp[2])-1);     // and eax, ht.size()-1
        put4(0x0fb60406);              // movzx eax, byte [esi+eax]
        put2(0xd3e8);                  // shr eax, cl
        put3(0x83e001);                // and eax, 1  ; predicted bit
        put2a(0x8987, offc(c));        // mov [edi+&c], eax ; c

        // p[i]=stretch(dt2k[cr.a]*(cr.c*-2+1)&32767);
        put2a(0x8b87, offc(a));        // mov eax, [edi+&a]
        put3a(0x8b8487, off(dt2k));    // mov eax, [edi+eax*4+&dt2k] ; weight
        put2(0x7402);                  // jz L1 ; z if c==0
        put2(0xf7d8);                  // neg eax
        put1a(0x25, 0x7fff);           // L1: and eax, 32767
        put4a(0x0fbf8447, off(stretcht)); //movsx eax, word [edi+eax*2+...]
        put2a(0x8987, off(p[i]));      // L2: mov [edi+&p[i]], eax
        break;

      case AVG: // j k wt
        // p[i]=(p[cp[1]]*cp[3]+p[cp[2]]*(256-cp[3]))>>8;

        put2a(0x8b87, off(p[cp[1]]));  // mov eax, [edi+&p[j]]
        put2a(0x2b87, off(p[cp[2]]));  // sub eax, [edi+&p[k]]
        put2a(0x69c0, cp[3]);          // imul eax, wt
        put3(0xc1f808);                // sar eax, 8
        put2a(0x0387, off(p[cp[2]]));  // add eax, [edi+&p[k]]
        put2a(0x8987, off(p[i]));      // mov [edi+&p[i]], eax
        break;

      case MIX2:   // sizebits j k rate mask
                   // c=size cm=wt[size] cxt=input
        // cr.cxt=((h[i]+(c8&cp[5]))&(cr.c-1));
        // assert(cr.cxt<cr.a16.size());
        // int w=cr.a16[cr.cxt];
        // assert(w>=0 && w<65536);
        // p[i]=(w*p[cp[2]]+(65536-w)*p[cp[3]])>>16;
        // assert(p[i]>=-2048 && p[i]<2048);

        put2(0x8b07);                  // mov eax, [edi] ; c8
        put1a(0x25, cp[5]);            // and eax, mask
        put2a(0x0387, off(h[i]));      // add eax, [edi+&h[i]]
        put1a(0x25, (1<<cp[1])-1);     // and eax, size-1
        put2a(0x8987, offc(cxt));      // mov [edi+&cxt], eax ; cxt
        if (S==8) put1(0x48);          // rex.w
        put2a(0x8bb7, offc(a16));      // mov esi, [edi+&a16]
        put4(0x0fb70446);              // movzx eax, word [edi+eax*2] ; w
        put2a(0x8b8f, off(p[cp[2]]));  // mov ecx, [edi+&p[j]]
        put2a(0x8b97, off(p[cp[3]]));  // mov edx, [edi+&p[k]]
        put2(0x29d1);                  // sub ecx, edx
        put3(0x0fafc8);                // imul ecx, eax
        put3(0xc1e210);                // shl edx, 16
        put2(0x01d1);                  // add ecx, edx
        put3(0xc1f910);                // sar ecx, 16
        put2a(0x898f, off(p[i]));      // mov [edi+&p[i]]
        break;

      case MIX:    // sizebits j m rate mask
                   // c=size cm=wt[size][m] cxt=index of wt in cm
        // int m=cp[3];
        // assert(m>=1 && m<=i);
        // cr.cxt=h[i]+(c8&cp[5]);
        // cr.cxt=(cr.cxt&(cr.c-1))*m; // pointer to row of weights
        // assert(cr.cxt<=cr.cm.size()-m);
        // int* wt=(int*)&cr.cm[cr.cxt];
        // p[i]=0;
        // for (int j=0; j<m; ++j)
        //   p[i]+=(wt[j]>>8)*p[cp[2]+j];
        // p[i]=clamp2k(p[i]>>8);

        put2(0x8b07);                          // mov eax, [edi] ; c8
        put1a(0x25, cp[5]);                    // and eax, mask
        put2a(0x0387, off(h[i]));              // add eax, [edi+&h[i]]
        put1a(0x25, (1<<cp[1])-1);             // and eax, size-1
        put2a(0x69c0, cp[3]);                  // imul eax, m
        put2a(0x8987, offc(cxt));              // mov [edi+&cxt], eax ; cxt
        if (S==8) put1(0x48);                  // rex.w
        put2a(0x8bb7, offc(cm));               // mov esi, [edi+&cm]
        if (S==8) put1(0x48);                  // rex.w
        put3(0x8d3486);                        // lea esi, [esi+eax*4] ; wt

        // Unroll summation loop: esi=wt[0..m-1]
        for (int k=0; k<cp[3]; k+=8) {
          const int tail=cp[3]-k;  // number of elements remaining

          // pack 8 elements of wt in xmm1, 8 elements of p in xmm3
          put4a(0xf30f6f8e, k*4);              // movdqu xmm1, [esi+k*4]
          if (tail>3) put4a(0xf30f6f96, k*4+16);//movdqu xmm2, [esi+k*4+16]
          put5(0x660f72e1,0x08);               // psrad xmm1, 8
          if (tail>3) put5(0x660f72e2,0x08);   // psrad xmm2, 8
          put4(0x660f6bca);                    // packssdw xmm1, xmm2
          put4a(0xf30f6f9f, off(p[cp[2]+k]));  // movdqu xmm3, [edi+&p[j+k]]
          if (tail>3)
            put4a(0xf30f6fa7,off(p[cp[2]+k+4]));//movdqu xmm4, [edi+&p[j+k+4]]
          put4(0x660f6bdc);                    // packssdw, xmm3, xmm4
          if (tail>0 && tail<8) {  // last loop, mask extra weights
            put4(0x660f76ed);                  // pcmpeqd xmm5, xmm5 ; -1
            put5(0x660f73dd, 16-tail*2);       // psrldq xmm5, 16-tail*2
            put4(0x660fdbcd);                  // pand xmm1, xmm5
          }
          if (k==0) {  // first loop, initialize sum in xmm0
            put4(0xf30f6fc1);                  // movdqu xmm0, xmm1
            put4(0x660ff5c3);                  // pmaddwd xmm0, xmm3
          }
          else {  // accumulate sum in xmm0
            put4(0xf30f6fd1);                  // movdqu xmm2, xmm1
            put4(0x660ff5d3);                  // pmaddwd xmm2, xmm3
            put4(0x660ffec2);                  // paddd, xmm0, xmm2
          }
        }

        // Add up the 4 elements of xmm0 = p[i] in the first element
        put4(0xf30f6fc8);                      // movdqu xmm1, xmm0
        put5(0x660f73d9,0x08);                 // psrldq xmm1, 8
        put4(0x660ffec1);                      // paddd xmm0, xmm1
        put4(0xf30f6fc8);                      // movdqu xmm1, xmm0
        put5(0x660f73d9,0x04);                 // psrldq xmm1, 4
        put4(0x660ffec1);                      // paddd xmm0, xmm1
        put4(0x660f7ec0);                      // movd eax, xmm0 ; p[i]
        put3(0xc1f808);                        // sar eax, 8
        put1a(0xb9, 2047);                     // mov ecx, 2047 ; clamp2k
        put2(0x39c8);                          // cmp eax, ecx
        put3(0x0f4fc1);                        // cmovg eax, ecx
        put2(0xf7d1);                          // not ecx ; -2048
        put2(0x39c8);                          // cmp eax, ecx
        put3(0x0f4cc1);                        // cmovl eax, ecx
        put2a(0x8987, off(p[i]));              // mov [edi+&p[i]], eax
        break;

      case SSE:  // sizebits j start limit
        // cr.cxt=(h[i]+c8)*32;
        // int pq=p[cp[2]]+992;
        // if (pq<0) pq=0;
        // if (pq>1983) pq=1983;
        // int wt=pq&63;
        // pq>>=6;
        // assert(pq>=0 && pq<=30);
        // cr.cxt+=pq;
        // p[i]=stretch(((cr.cm(cr.cxt)>>10)*(64-wt)       // p0
        //               +(cr.cm(cr.cxt+1)>>10)*wt)>>13);  // p1
        // // p = p0*(64-wt)+p1*wt = (p1-p0)*wt + p0*64
        // cr.cxt+=wt>>5;

        put2a(0x8b8f, off(h[i]));      // mov ecx, [edi+&h[i]]
        put2(0x030f);                  // add ecx, [edi]  ; c0
        put2a(0x81e1, (1<<cp[1])-1);   // and ecx, size-1
        put3(0xc1e105);                // shl ecx, 5  ; cxt in 0..size*32-32
        put2a(0x8b87, off(p[cp[2]]));  // mov eax, [edi+&p[j]] ; pq
        put1a(0x05, 992);              // add eax, 992
        put2(0x31d2);                  // xor edx, edx ; 0
        put2(0x39d0);                  // cmp eax, edx
        put3(0x0f4cc2);                // cmovl eax, edx
        put1a(0xba, 1983);             // mov edx, 1983
        put2(0x39d0);                  // cmp eax, edx
        put3(0x0f4fc2);                // cmovg eax, edx ; pq in 0..1983
        put2(0x89c2);                  // mov edx, eax
        put3(0x83e23f);                // and edx, 63  ; wt in 0..63
        put3(0xc1e806);                // shr eax, 6   ; pq in 0..30
        put2(0x01c1);                  // add ecx, eax ; cxt in 0..size*32-2
        if (S==8) put1(0x48);          // rex.w
        put2a(0x8bb7, offc(cm));       // mov esi, [edi+cm]
        put3(0x8b048e);                // mov eax, [esi+ecx*4] ; cm[cxt]
        put4(0x8b5c8e04);              // mov ebx, [esi+ecx*4+4] ; cm[cxt+1]
        put3(0x83fa20);                // cmp edx, 32  ; wt
        put3(0x83d9ff);                // sbb ecx, -1  ; cxt+=wt>>5
        put2a(0x898f, offc(cxt));      // mov [edi+cxt], ecx  ; cxt saved
        put3(0xc1e80a);                // shr eax, 10 ; p0 = cm[cxt]>>10
        put3(0xc1eb0a);                // shr ebx, 10 ; p1 = cm[cxt+1]>>10
        put2(0x29c3);                  // sub ebx, eax, ; p1-p0
        put3(0x0fafda);                // imul ebx, edx ; (p1-p0)*wt
        put3(0xc1e006);                // shr eax, 6
        put2(0x01d8);                  // add eax, ebx ; p in 0..2^28-1
        put3(0xc1e80d);                // shr eax, 13  ; p in 0..32767
        put4a(0x0fbf8447, off(stretcht));  // movsx eax, word [edi+eax*2+...]
        put2a(0x8987, off(p[i]));      // mov [edi+&p[i]], eax
        break;

      default:
        error("invalid ZPAQ component");
    }
  }

  // return squash(p[n-1])
  put2a(0x8b87, off(p[n-1]));          // mov eax, [edi+...]
  put1a(0x05, 0x800);                  // add eax, 2048
  put4a(0x0fbf8447, off(squasht[0]));  // movsx eax, word [edi+eax*2+...]
  put1(0x5f);                          // pop edi
  put1(0x5e);                          // pop esi
  put1(0x5d);                          // pop ebp
  put1(0x5b);                          // pop ebx
  put1(0xc3);                          // ret

  // Initialize for update() Put predictor address in edi/rdi
  // and bit y=0..1 in ebp
  int save_o=o;
  o=5;
  put1a(0xe9, save_o-10);      // jmp update
  o=save_o;
  put1(0x53);                  // push ebx/rbx
  put1(0x55);                  // push ebp/rbp
  put1(0x56);                  // push esi/rsi
  put1(0x57);                  // push edi/rdi
  if (S==4) {
    put4(0x8b7c2414);          // mov edi,[esp+0x14] ; (1st arg = pr)
    put4(0x8b6c2418);          // mov ebp,[esp+0x18] ; (2nd arg = y)
  }
  else {
#ifndef _WIN32
    put3(0x4889f5);            // mov rbp, rsi (2nd arg in Linux-64)
#else
    put3(0x4889cf);            // mov rdi, rcx (1st arg in Win64)
    put3(0x4889d5);            // mov rbp, rdx (2nd arg)
#endif
  }

  // Code update() for each component
  cp=hcomp+7;
  for (int i=0; i<n; ++i, cp+=compsize[cp[0]]) {
    assert(cp-hcomp<pr.z.cend);
    assert (cp[0]>=1 && cp[0]<=9);
    assert(compsize[cp[0]]>0 && compsize[cp[0]]<8);
    switch (cp[0]) {

      case CONS:  // c
        break;

      case SSE:  // sizebits j start limit
      case CM:   // sizebits limit
        // train(cr, y);
        //
        // reduce prediction error in cr.cm
        // void train(Component& cr, int y) {
        //   assert(y==0 || y==1);
        //   U32& pn=cr.cm(cr.cxt);
        //   U32 count=pn&0x3ff;
        //   int error=y*32767-(cr.cm(cr.cxt)>>17);
        //   pn+=(error*dt[count]&-1024)+(count<cr.limit);

        if (S==8) put1(0x48);          // rex.w (esi->rsi)
        put2a(0x8bb7, offc(cm));       // mov esi,[edi+cm]  ; cm
        put2a(0x8b87, offc(cxt));      // mov eax,[edi+cxt] ; cxt
        put1a(0x25, pr.comp[i].cm.size()-1);  // and eax, size-1
        if (S==8) put1(0x48);          // rex.w
        put3(0x8d3486);                // lea esi,[esi+eax*4] ; &cm[cxt]
        put2(0x8b06);                  // mov eax,[esi] ; cm[cxt]
        put2(0x89c2);                  // mov edx, eax  ; cm[cxt]
        put3(0xc1e811);                // shr eax, 17   ; cm[cxt]>>17
        put2(0x89e9);                  // mov ecx, ebp  ; y
        put3(0xc1e10f);                // shl ecx, 15   ; y*32768
        put2(0x29e9);                  // sub ecx, ebp  ; y*32767
        put2(0x29c1);                  // sub ecx, eax  ; error
        put2a(0x81e2, 0x3ff);          // and edx, 1023 ; count
        put3a(0x8b8497, off(dt));      // mov eax,[edi+edx*4+dt] ; dt[count]
        put3(0x0fafc8);                // imul ecx, eax ; error*dt[count]
        put2a(0x81e1, 0xfffffc00);     // and ecx, -1024
        put2a(0x81fa, cp[2+2*(cp[0]==SSE)]*4); // cmp edx, limit*4
        put2(0x110e);                  // adc [esi], ecx ; pn+=...
        break;

      case ICM:   // sizebits: cxt=bh, ht[c][0..15]=bh row
        // cr.ht[cr.c+(hmap4&15)]=st.next(cr.ht[cr.c+(hmap4&15)], y);
        // U32& pn=cr.cm(cr.cxt);
        // pn+=int(y*32767-(pn>>8))>>2;

      case ISSE:  // sizebits j  -- c=hi, cxt=bh
        // assert(cr.cxt==cr.ht[cr.c+(hmap4&15)]);
        // int err=y*32767-squash(p[i]);
        // int *wt=(int*)&cr.cm[cr.cxt*2];
        // wt[0]=clamp512k(wt[0]+((err*p[cp[2]]+(1<<12))>>13));
        // wt[1]=clamp512k(wt[1]+((err+16)>>5));
        // cr.ht[cr.c+(hmap4&15)]=st.next(cr.cxt, y);

        // update bit history bh to next(bh,y=ebp) in ht[c+(hmap4&15)]
        put3(0x8b4700+off(hmap4));     // mov eax, [edi+&hmap4]
        put3(0x83e00f);                // and eax, 15
        put2a(0x0387, offc(c));        // add eax [edi+&c] ; cxt
        if (S==8) put1(0x48);          // rex.w
        put2a(0x8bb7, offc(ht));       // mov esi, [edi+&ht]
        put4(0x0fb61406);              // movzx edx, byte [esi+eax] ; bh
        put4(0x8d5c9500);              // lea ebx, [ebp+edx*4] ; index to st
        put4a(0x0fb69c1f, off(st));    // movzx ebx,byte[edi+ebx+st]; next bh
        put3(0x881c06);                // mov [esi+eax], bl ; save next bh
        if (S==8) put1(0x48);          // rex.w
        put2a(0x8bb7, offc(cm));       // mov esi, [edi+&cm]

        // ICM: update cm[cxt=edx=bit history] to reduce prediction error
        // esi = &cm
        if (cp[0]==ICM) {
          if (S==8) put1(0x48);        // rex.w
          put3(0x8d3496);              // lea esi, [esi+edx*4] ; &cm[bh]
          put2(0x8b06);                // mov eax, [esi] ; pn
          put3(0xc1e808);              // shr eax, 8 ; pn>>8
          put2(0x89e9);                // mov ecx, ebp ; y
          put3(0xc1e10f);              // shl ecx, 15
          put2(0x29e9);                // sub ecx, ebp ; y*32767
          put2(0x29c1);                // sub ecx, eax
          put3(0xc1f902);              // sar ecx, 2
          put2(0x010e);                // add [esi], ecx
        }

        // ISSE: update weights. edx=cxt=bit history (0..255), esi=cm[512]
        else {
          put2a(0x8b87, off(p[i]));    // mov eax, [edi+&p[i]]
          put1a(0x05, 2048);           // add eax, 2048
          put4a(0x0fb78447, off(squasht)); // movzx eax, word [edi+eax*2+..]
          put2(0x89e9);                // mov ecx, ebp ; y
          put3(0xc1e10f);              // shl ecx, 15
          put2(0x29e9);                // sub ecx, ebp ; y*32767
          put2(0x29c1);                // sub ecx, eax ; err
          put2a(0x8b87, off(p[cp[2]]));// mov eax, [edi+&p[j]]
          put3(0x0fafc1);              // imul eax, ecx
          put1a(0x05, (1<<12));        // add eax, 4096
          put3(0xc1f80d);              // sar eax, 13
          put3(0x0304d6);              // add eax, [esi+edx*8] ; wt[0]
          put1a(0xbb, (1<<19)-1);      // mov ebx, 524287
          put2(0x39d8);                // cmp eax, ebx
          put3(0x0f4fc3);              // cmovg eax, ebx
          put2(0xf7d3);                // not ebx ; -524288
          put2(0x39d8);                // cmp eax, ebx
          put3(0x0f4cc3);              // cmovl eax, ebx
          put3(0x8904d6);              // mov [esi+edx*8], eax
          put3(0x83c110);              // add ecx, 16 ; err
          put3(0xc1f905);              // sar ecx, 5
          put4(0x034cd604);            // add ecx, [esi+edx*8+4] ; wt[1]
          put1a(0xb8, (1<<19)-1);      // mov eax, 524287
          put2(0x39c1);                // cmp ecx, eax
          put3(0x0f4fc8);              // cmovg ecx, eax
          put2(0xf7d0);                // not eax ; -524288
          put2(0x39c1);                // cmp ecx, eax
          put3(0x0f4cc8);              // cmovl ecx, eax
          put4(0x894cd604);            // mov [esi+edx*8+4], ecx
        }
        break;

      case MATCH: // sizebits bufbits:
                  //   a=len, b=offset, c=bit, cm=index, cxt=bitpos
                  //   ht=buf, limit=pos
        // assert(cr.a<=255);
        // assert(cr.c==0 || cr.c==1);
        // assert(cr.cxt<8);
        // assert(cr.cm.size()==(size_t(1)<<cp[1]));
        // assert(cr.ht.size()==(size_t(1)<<cp[2]));
        // if (int(cr.c)!=y) cr.a=0;  // mismatch?
        // cr.ht(cr.limit)+=cr.ht(cr.limit)+y;
        // if (++cr.cxt==8) {
        //   cr.cxt=0;
        //   ++cr.limit;
        //   cr.limit&=(1<<cp[2])-1;
        //   if (cr.a==0) {  // look for a match
        //     cr.b=cr.limit-cr.cm(h[i]);
        //     if (cr.b&(cr.ht.size()-1))
        //       while (cr.a<255
        //              && cr.ht(cr.limit-cr.a-1)==cr.ht(cr.limit-cr.a-cr.b-1))
        //         ++cr.a;
        //   }
        //   else cr.a+=cr.a<255;
        //   cr.cm(h[i])=cr.limit;
        // }

        // Set pointers ebx=&cm, esi=&ht
        if (S==8) put1(0x48);          // rex.w
        put2a(0x8bb7, offc(ht));       // mov esi, [edi+&ht]
        if (S==8) put1(0x48);          // rex.w
        put2a(0x8b9f, offc(cm));       // mov ebx, [edi+&cm]

        // if (c!=y) a=0;
        put2a(0x8b87, offc(c));        // mov eax, [edi+&c]
        put2(0x39e8);                  // cmp eax, ebp ; y
        put2(0x7408);                  // jz L1
        put2(0x31c0);                  // xor eax, eax
        put2a(0x8987, offc(a));        // mov [edi+&a], eax

        // ht(limit)+=ht(limit)+y  (1E)
        put2a(0x8b87, offc(limit));    // mov eax, [edi+&limit]
        put4(0x0fb60c06);              // movzx, ecx, byte [esi+eax]
        put2(0x01c9);                  // add ecx, ecx
        put2(0x01e9);                  // add ecx, ebp
        put3(0x880c06);                // mov [esi+eax], cl

        // if (++cxt==8)
        put2a(0x8b87, offc(cxt));      // mov eax, [edi+&cxt]
        put2(0xffc0);                  // inc eax
        put3(0x83e007);                // and eax,byte +0x7
        put2a(0x8987, offc(cxt));      // mov [edi+&cxt],eax
        put2a(0x0f85, 0x9b);           // jnz L8

        // ++limit;
        // limit&=bufsize-1;
        put2a(0x8b87, offc(limit));    // mov eax,[edi+&limit]
        put2(0xffc0);                  // inc eax
        put1a(0x25, (1<<cp[2])-1);     // and eax, bufsize-1
        put2a(0x8987, offc(limit));    // mov [edi+&limit],eax

        // if (a==0)
        put2a(0x8b87, offc(a));        // mov eax, [edi+&a]
        put2(0x85c0);                  // test eax,eax
        put2(0x755c);                  // jnz L6

        //   b=limit-cm(h[i])
        put2a(0x8b8f, off(h[i]));      // mov ecx,[edi+h[i]]
        put2a(0x81e1, (1<<cp[1])-1);   // and ecx, size-1
        put2a(0x8b87, offc(limit));    // mov eax,[edi-&limit]
        put3(0x2b048b);                // sub eax,[ebx+ecx*4]
        put2a(0x8987, offc(b));        // mov [edi+&b],eax

        //   if (b&(bufsize-1))
        put1a(0xa9, (1<<cp[2])-1);     // test eax, bufsize-1
        put2(0x7448);                  // jz L7

        //      while (a<255 && ht(limit-a-1)==ht(limit-a-b-1)) ++a;
        put1(0x53);                    // push ebx
        put2a(0x8b9f, offc(limit));    // mov ebx,[edi+&limit]
        put2(0x89da);                  // mov edx,ebx
        put2(0x29c3);                  // sub ebx,eax  ; limit-b
        put2(0x31c9);                  // xor ecx,ecx  ; a=0
        put2a(0x81f9, 0xff);           // L2: cmp ecx,0xff ; while
        put2(0x741c);                  // jz L3 ; break
        put2(0xffca);                  // dec edx
        put2(0xffcb);                  // dec ebx
        put2a(0x81e2, (1<<cp[2])-1);   // and edx, bufsize-1
        put2a(0x81e3, (1<<cp[2])-1);   // and ebx, bufsize-1
        put3(0x8a0416);                // mov al,[esi+edx]
        put3(0x3a041e);                // cmp al,[esi+ebx]
        put2(0x7504);                  // jnz L3 ; break
        put2(0xffc1);                  // inc ecx
        put2(0xebdc);                  // jmp short L2 ; end while
        put1(0x5b);                    // L3: pop ebx
        put2a(0x898f, offc(a));        // mov [edi+&a],ecx
        put2(0xeb0e);                  // jmp short L7

        // a+=(a<255)
        put1a(0x3d, 0xff);             // L6: cmp eax, 0xff ; a
        put3(0x83d000);                // adc eax, 0
        put2a(0x8987, offc(a));        // mov [edi+&a],eax

        // cm(h[i])=limit
        put2a(0x8b87, off(h[i]));      // L7: mov eax,[edi+&h[i]]
        put1a(0x25, (1<<cp[1])-1);     // and eax, size-1
        put2a(0x8b8f, offc(limit));    // mov ecx,[edi+&limit]
        put3(0x890c83);                // mov [ebx+eax*4],ecx
                                       // L8:
        break;

      case AVG:  // j k wt
        break;

      case MIX2: // sizebits j k rate mask
                 // cm=wt[size], cxt=input
        // assert(cr.a16.size()==cr.c);
        // assert(cr.cxt<cr.a16.size());
        // int err=(y*32767-squash(p[i]))*cp[4]>>5;
        // int w=cr.a16[cr.cxt];
        // w+=(err*(p[cp[2]]-p[cp[3]])+(1<<12))>>13;
        // if (w<0) w=0;
        // if (w>65535) w=65535;
        // cr.a16[cr.cxt]=w;

        // set ecx=err
        put2a(0x8b87, off(p[i]));      // mov eax, [edi+&p[i]]
        put1a(0x05, 2048);             // add eax, 2048
        put4a(0x0fb78447, off(squasht));//movzx eax, word [edi+eax*2+&squasht]
        put2(0x89e9);                  // mov ecx, ebp ; y
        put3(0xc1e10f);                // shl ecx, 15
        put2(0x29e9);                  // sub ecx, ebp ; y*32767
        put2(0x29c1);                  // sub ecx, eax
        put2a(0x69c9, cp[4]);          // imul ecx, rate
        put3(0xc1f905);                // sar ecx, 5  ; err

        // Update w
        put2a(0x8b87, offc(cxt));      // mov eax, [edi+&cxt]
        if (S==8) put1(0x48);          // rex.w
        put2a(0x8bb7, offc(a16));      // mov esi, [edi+&a16]
        if (S==8) put1(0x48);          // rex.w
        put3(0x8d3446);                // lea esi, [esi+eax*2] ; &w
        put2a(0x8b87, off(p[cp[2]]));  // mov eax, [edi+&p[j]]
        put2a(0x2b87, off(p[cp[3]]));  // sub eax, [edi+&p[k]] ; p[j]-p[k]
        put3(0x0fafc1);                // imul eax, ecx  ; * err
        put1a(0x05, 1<<12);            // add eax, 4096
        put3(0xc1f80d);                // sar eax, 13
        put3(0x0fb716);                // movzx edx, word [esi] ; w
        put2(0x01d0);                  // add eax, edx
        put1a(0xba, 0xffff);           // mov edx, 65535
        put2(0x39d0);                  // cmp eax, edx
        put3(0x0f4fc2);                // cmovg eax, edx
        put2(0x31d2);                  // xor edx, edx
        put2(0x39d0);                  // cmp eax, edx
        put3(0x0f4cc2);                // cmovl eax, edx
        put3(0x668906);                // mov word [esi], ax
        break;

      case MIX: // sizebits j m rate mask
                // cm=wt[size][m], cxt=input
        // int m=cp[3];
        // assert(m>0 && m<=i);
        // assert(cr.cm.size()==m*cr.c);
        // assert(cr.cxt+m<=cr.cm.size());
        // int err=(y*32767-squash(p[i]))*cp[4]>>4;
        // int* wt=(int*)&cr.cm[cr.cxt];
        // for (int j=0; j<m; ++j)
        //   wt[j]=clamp512k(wt[j]+((err*p[cp[2]+j]+(1<<12))>>13));

        // set ecx=err
        put2a(0x8b87, off(p[i]));      // mov eax, [edi+&p[i]]
        put1a(0x05, 2048);             // add eax, 2048
        put4a(0x0fb78447, off(squasht));//movzx eax, word [edi+eax*2+&squasht]
        put2(0x89e9);                  // mov ecx, ebp ; y
        put3(0xc1e10f);                // shl ecx, 15
        put2(0x29e9);                  // sub ecx, ebp ; y*32767
        put2(0x29c1);                  // sub ecx, eax
        put2a(0x69c9, cp[4]);          // imul ecx, rate
        put3(0xc1f904);                // sar ecx, 4  ; err

        // set esi=wt
        put2a(0x8b87, offc(cxt));      // mov eax, [edi+&cxt] ; cxt
        if (S==8) put1(0x48);          // rex.w
        put2a(0x8bb7, offc(cm));       // mov esi, [edi+&cm]
        if (S==8) put1(0x48);          // rex.w
        put3(0x8d3486);                // lea esi, [esi+eax*4] ; wt

        for (int k=0; k<cp[3]; ++k) {
          put2a(0x8b87,off(p[cp[2]+k]));//mov eax, [edi+&p[cp[2]+k]
          put3(0x0fafc1);              // imul eax, ecx
          put1a(0x05, 1<<12);          // add eax, 1<<12
          put3(0xc1f80d);              // sar eax, 13
          put2(0x0306);                // add eax, [esi]
          put1a(0xba, (1<<19)-1);      // mov edx, (1<<19)-1
          put2(0x39d0);                // cmp eax, edx
          put3(0x0f4fc2);              // cmovg eax, edx
          put2(0xf7d2);                // not edx
          put2(0x39d0);                // cmp eax, edx
          put3(0x0f4cc2);              // cmovl eax, edx
          put2(0x8906);                // mov [esi], eax
          if (k<cp[3]-1) {
            if (S==8) put1(0x48);      // rex.w
            put3(0x83c604);            // add esi, 4
          }
        }
        break;

      default:
        error("invalid ZPAQ component");
    }
  }

  // return from update()
  put1(0x5f);                 // pop edi
  put1(0x5e);                 // pop esi
  put1(0x5d);                 // pop ebp
  put1(0x5b);                 // pop ebx
  put1(0xc3);                 // ret

  return o;
}

#endif // ifndef NOJIT

// Return a prediction of the next bit in range 0..32767
// Use JIT code starting at pcode[0] if available, or else create it.
int Predictor::predict() {
#ifdef NOJIT
  return predict0();
#else
  if (!pcode) {
    int n=assemble_p();
    allocx(pcode, pcode_size, n);
    if (!pcode || n!=assemble_p() || n<10 || pcode_size<10)
      error("predictor JIT failed");
  }
  assert(pcode && pcode[0]);
  return ((int(*)(Predictor*))&pcode[0])(this);
#endif
}

// Update the model with bit y = 0..1
// Use the JIT code starting at pcode[5].
void Predictor::update(int y) {
#ifdef NOJIT
  update0(y);
#else
  assert(pcode && pcode[5]);
  ((void(*)(Predictor*, int))&pcode[5])(this, y);

  // Save bit y in c8, hmap4 (not implemented in JIT)
  c8+=c8+y;
  if (c8>=256) {
    z.run(c8-256);
    hmap4=1;
    c8=1;
    for (int i=0; i<z.header[6]; ++i) h[i]=z.H(i);
  }
  else if (c8>=16 && c8<32)
    hmap4=(hmap4&0xf)<<5|y<<4|1;
  else
    hmap4=(hmap4&0x1f0)|(((hmap4&0xf)*2+y)&0xf);
#endif
}

// Execute the ZPAQL code with input byte or -1 for EOF.
// Use JIT code at rcode if available, or else create it.
void ZPAQL::run(U32 input) {
#ifdef NOJIT
  run0(input);
#else
  if (!rcode) {
    int n=assemble();
    allocx(rcode, rcode_size, n);
    if (!rcode || n<10 || rcode_size<10 || n!=assemble())
      error("run JIT failed");
  }
  a=input;
  if (!((int(*)())(&rcode[0]))())
    libzpaq::error("Bad ZPAQL opcode");
#endif
}

}  // end namespace libzpaq
