---
title: "Day4：【LeetCode-三周攻克数据结构 】题目分析笔记（C语言）"
slug: leetcode-data-structure-day-4
date: 2022-01-13 13:56:50
updated: 2022-01-13 13:56:50
categories:
  - "算法"
  - "LeetCode"
tags:
  - "矩阵"
  - "线性代数"
  - "matlab"
  - "LeetCode"
cover: /images/posts/backend-cover.webp
description: "本文介绍了如何在C语言中实现矩阵重塑的功能，并通过代码详细解释了解题思路及关键步骤。此外，还提供了生成杨辉三角的解决方案，包括完整的代码实现和算法分析。"
original_url: "https://blog.csdn.net/qq_41725967/article/details/122471503"
original_platform: CSDN
---

本文介绍了如何在C语言中实现矩阵重塑的功能，并通过代码详细解释了解题思路及关键步骤。此外，还提供了生成杨辉三角的解决方案，包括完整的代码实现和算法分析。

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/122471503)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

## 一、重塑矩阵

### 1、题目：

**在 MATLAB 中，有一个非常有用的函数 reshape ，它可以将一个 m x n 矩阵重塑为另一个大小不同（r x c）的新矩阵，但保留其原始数据。**  
**给你一个由二维数组 mat 表示的 m x n 矩阵，以及两个正整数 r 和 c ，分别表示想要的重构的矩阵的行数和列数。**  
**重构后的矩阵需要将原始矩阵的所有元素以相同的 行遍历顺序 填充。如果具有给定参数的 reshape 操作是可行且合理的，则输出新的重塑矩阵；否则，输出原始矩阵。**

### 2、代码如下：

```c
int** matrixReshape(int** mat, int matSize, int* matColSize, int r, int c, int* returnSize, int** returnColumnSizes){
    if(matSize * (*matColSize) != r *c){
        *returnSize = matSize;
        *returnColumnSizes = matColSize;
        return mat;
    }
//给二维数组开辟空间
    int **ans = malloc(sizeof(int*)*r);
    *returnColumnSizes = malloc(sizeof(int*)*r);
    for(int i=0;i<r;i++){
        ans[i] = malloc(sizeof(int*)*c);
        (*returnColumnSizes)[i] = c;
    }
//对矩阵进行重塑
    int v = 0;
    for(int i=0;i<matSize;i++){
        for(int j=0;j<*matColSize;j++){
            v = i * (*matColSize) + j;
            ans[v/c][v%c] = mat[i][j];
        }
    }
    *returnSize = r;
    return ans;
}
```

### 3、解题思路：

首先判断原矩阵元素个数（m x n）是否与新矩阵元素个数（r x c）相等，若不相等，则返回原数组；  
若相等，则先给二维数组开辟空间，具体方法关键语句分析将会给出；  
最后一步就是将原矩阵的元素以行遍历顺序入新矩阵中，这里采用将原矩阵展开成以**行遍历顺序**的一维数组，计算`mat[i][j]`对应到一维数组的下标，：`v = i * 列数 + j`，之后再将`v`对应到新矩阵的位置中：`ans[v/c][v%c] = mat[i][j]`。

### 4、关键语句分析：

##### 1、

```c
给二维数组开辟空间
    int **ans = malloc(sizeof(int*)*r);
    *returnColumnSizes = malloc(sizeof(int*)*r);
    for(int i=0;i<r;i++){
        ans[i] = malloc(sizeof(int*)*c);
        (*returnColumnSizes)[i] = c;
    }
```

给二维数组开辟空间的方法为：先给二维数组的每一行开辟空间，再对每一行中开辟对应多少列的空间，通俗的理解就是第一次开辟的空间代表了行地址，然后行地址的后边是我们开辟的列的空间（这个列其实就是个一维数组）代表列，地址下还有地址，所以这里用到了双重指针。

##### 2、

```c
//对矩阵进行重塑
    int v = 0;
    for(int i=0;i<matSize;i++){
        for(int j=0;j<*matColSize;j++){
            v = i * (*matColSize) + j;
            ans[v/c][v%c] = mat[i][j];
        }
    }
```

对于已经计算得到的`v`，我们需要计算得到`v`对应在新矩阵（r行，c列）中的行数和列数，公式为：  
`行数 = v / c`，`列数 = v % c`

## 二、杨辉三角

### 1、题目：

**给定一个非负整数 numRows，生成「杨辉三角」的前 numRows 行。  
在「杨辉三角」中，每个数是它左上方和右上方的数的和。**

### 2、代码如下：

```c
int** generate(int numRows, int* returnSize, int** returnColumnSizes){
    *returnSize = numRows;
    int **ans = malloc(sizeof(int*)*numRows);
    *returnColumnSizes = malloc(sizeof(int*)*numRows);
    for(int i=0;i<numRows;i++){
        ans[i] = malloc(sizeof(int*)*(i+1));
        (*returnColumnSizes)[i] = (i+1);
        ans[i][0] = ans[i][i] = 1;
        for(int j=1;j<i;j++){
            ans[i][j] = ans[i-1][j] + ans[i-1][j-1];
        }
    }
    return ans;
}
```

### 3、解题思路：

与上一题类似，都涉及二维数组的题目，上一题行空间分配后每一行的元素个数是一样的，这题第`i`行有`（i+1）`个元素  
剩下的就是数学问题，根据杨辉三角的特点我们不难计算得到：  
`ans[i][j] = ans[i-1][j] + ans[i-1][j-1];`

### 4、关键语句分析：

##### 1、

```c
for(int j=1;j<i;j++){
            ans[i][j] = ans[i-1][j] + ans[i-1][j-1];
        }
```

因为两边的元素赋值为1了，所以每一行从第一个元素开始计算就行啦~
