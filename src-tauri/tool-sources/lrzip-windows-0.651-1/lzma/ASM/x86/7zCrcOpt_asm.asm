; 7zCrcOpt.asm -- CRC32 calculation : optimized version
; 2009-12-12 : Igor Pavlov : Public domain

%include "7zAsm.asm"

MY_ASM_START

%define rD    r2
%define rN     r7

%ifdef x64
    %define num_VAR      r8
    %define table_VAR    r9
%else
    data_size   equ (REG_SIZE * 7)
    crc_table   equ (REG_SIZE + data_size)
    %define num_VAR     [r4 + data_size]
    %define table_VAR   [r4 + crc_table]
%endif

%define SRCDAT  rN + rD + 4 *

%macro CRC 4  ;CRC macro op:req, dest:req, src:req, t:req
    %1      %2, DWORD [r5 + %3 * 4 + 0400h * %4]  ; op      dest, DWORD [r5 + src * 4 + 0400h * t]
%endmacro

%macro CRC_XOR 3  ; CRC_XOR macro dest:req, src:req, t:req
    CRC xor, %1, %2, %3
%endmacro

%macro CRC_MOV 3  ; CRC_MOV macro dest:req, src:req, t:req
    CRC mov, %1, %2, %3   ; CRC mov, dest, src, t
%endmacro

%macro CRC1b 0
    movzx   x6, BYTE [rD]
    inc     rD
    movzx   x3, x0_L
    xor     x6, x3
    shr     x0, 8
    CRC     xor, x0, r6, 0
    dec     rN
%endmacro

%macro  MY_PROLOG 1 ; MY_PROLOG macro crc_end:req
    MY_PUSH_4_REGS


%ifdef x64
  %ifdef CYGWIN64
    ;ECX=CRC, RDX=buf, R8=size R9=table
    ; already in R8  : mov num_VAR,R8 ; LEN
    ; already in RDX : mov rD, RDX ; BUF
    ; already in R9  : mov table_VAR,R9; table
    mov x0, ECX ; CRC
  %else
    ;EDI=CRC, RSI=buf, RDX=size RCX=table
    mov num_VAR,RDX ; LEN
    mov rD, RSI ; BUF
    mov table_VAR,RCX; table
    mov x0, EDI ; CRC
  %endif
%else
    mov     x0, [r4 + 20]  ; CRC
    mov     rD, [r4 + 24]  ; buf
%endif
    mov     rN, num_VAR
    mov     r5, table_VAR
    test    rN, rN
    jz   near   %1 ; crc_end
  %%sl:
    test    rD, 7
    jz     %%sl_end
    CRC1b
    jnz     %%sl
  %%sl_end:
    cmp     rN, 16
    jb   near   %1; crc_end
    add     rN, rD
    mov     num_VAR, rN
    sub     rN, 8
    and     rN, NOT 7
    sub     rD, rN
    xor     x0, [SRCDAT 0]
%endmacro

%macro MY_EPILOG 1  ; MY_EPILOG macro crc_end:req
    xor     x0, [SRCDAT 0]
    mov     rD, rN
    mov     rN, num_VAR
    sub     rN, rD
  %1:  ; crc_end:
    test    rN, rN
    jz      %%end ; @F
    CRC1b
    jmp     %1 ; crc_end
  %%end:
    MY_POP_4_REGS
%endmacro

MY_PROC CrcUpdateT8, 4
    MY_PROLOG crc_end_8
    mov     x1, [SRCDAT 1]
    align 16
  main_loop_8:
    mov     x6, [SRCDAT 2]
    movzx   x3, x1_L
    CRC_XOR x6, r3, 3
    movzx   x3, x1_H
    CRC_XOR x6, r3, 2
    shr     x1, 16
    movzx   x3, x1_L
    movzx   x1, x1_H
    CRC_XOR x6, r3, 1
    movzx   x3, x0_L
    CRC_XOR x6, r1, 0

    mov     x1, [SRCDAT 3]
    CRC_XOR x6, r3, 7
    movzx   x3, x0_H
    shr     x0, 16
    CRC_XOR x6, r3, 6
    movzx   x3, x0_L
    CRC_XOR x6, r3, 5
    movzx   x3, x0_H
    CRC_MOV x0, r3, 4
    xor     x0, x6
    add     rD, 8
    jnz     main_loop_8

    MY_EPILOG crc_end_8
MY_ENDP

; T4 CRC deleted

; end

%ifidn __OUTPUT_FORMAT__,elf
section .note.GNU-stack noalloc noexec nowrite progbits
%endif

