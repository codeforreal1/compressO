; 7zAsm.asm -- ASM macros
; 2009-12-12 : Igor Pavlov : Public domain
; 2011-10-12 : P7ZIP       : Public domain

%define NOT ~

%macro MY_ASM_START 0
  SECTION .text
%endmacro

%macro MY_PROC 2 ; macro name:req, numParams:req
  align 16
  %define proc_numParams %2 ; numParams
    global %1
    global _%1
    %1:
    _%1:
%endmacro

%macro  MY_ENDP 0
  %ifdef x64
    ret
    ; proc_name ENDP
  %else
    ret ; (proc_numParams - 2) * 4
  %endif
%endmacro

%ifdef x64
  REG_SIZE equ 8
%else
  REG_SIZE equ 4
%endif

  %define x0  EAX
  %define x1  ECX
  %define x2  EDX
  %define x3  EBX
  %define x4  ESP
  %define x5  EBP
  %define x6  ESI
  %define x7  EDI

  %define x0_L  AL
  %define x1_L  CL
  %define x2_L  DL
  %define x3_L  BL

  %define x0_H  AH
  %define x1_H  CH
  %define x2_H  DH
  %define x3_H  BH

%ifdef x64
  %define r0  RAX
  %define r1  RCX
  %define r2  RDX
  %define r3  RBX
  %define r4  RSP
  %define r5  RBP
  %define r6  RSI
  %define r7  RDI
%else
  %define r0  x0
  %define r1  x1
  %define r2  x2
  %define r3  x3
  %define r4  x4
  %define r5  x5
  %define r6  x6
 %define  r7  x7
%endif

%macro MY_PUSH_4_REGS 0
    push    r3
    push    r5
%ifdef x64
  %ifdef CYGWIN64
    push    r6
    push    r7
  %endif
%else
    push    r6
    push    r7
%endif
%endmacro

%macro MY_POP_4_REGS 0
%ifdef x64
  %ifdef CYGWIN64
    pop     r7
    pop     r6
  %endif
%else
    pop     r7
    pop     r6
%endif
    pop     r5
    pop     r3
%endmacro
