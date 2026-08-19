---
title: "Day5：【LeetCode-三周攻克数据结构 】题目分析笔记（C语言）"
slug: leetcode-data-structure-day-5
date: 2022-01-13 17:39:32
updated: 2022-01-13 17:39:32
categories:
  - "算法"
  - "LeetCode"
tags:
  - "数据结构"
  - "LeetCode"
  - "C"
cover: /images/posts/backend-cover.webp
description: "本文介绍如何验证数独的有效性及实现矩阵置零的算法。针对数独验证，提出了遍历行、列和宫格的方法来确保每行、每列及每个宫格内的数字1-9不重复。对于矩阵置零问题，则采用标记法实现，通过两次遍历分别标记含有0的行和列，最后将这些行和列置零。"
original_url: "https://blog.csdn.net/qq_41725967/article/details/122477734"
original_platform: CSDN
---

本文介绍如何验证数独的有效性及实现矩阵置零的算法。针对数独验证，提出了遍历行、列和宫格的方法来确保每行、每列及每个宫格内的数字1-9不重复。对于矩阵置零问题，则采用标记法实现，通过两次遍历分别标记含有0的行和列，最后将这些行和列置零。

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/122477734)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

## 一、有效的数独

### 1、题目：

**请你判断一个 9 x 9 的数独是否有效。只需要 根据以下规则 ，验证已经填入的数字是否有效即可。**

**数字 1-9 在每一行只能出现一次。**  
**数字 1-9 在每一列只能出现一次。**  
**数字 1-9 在每一个以粗实线分隔的 3x3 宫内只能出现一次。**\*

**注意：**

**一个有效的数独（部分已被填充）不一定是可解的。**  
**只需要根据以上规则，验证已经填入的数字是否有效即可。**  
**空白格用 ‘.’ 表示。**

### 2、代码如下：

```c
bool isValidSudoku(char** board, int boardSize, int* boardColSize){
    int check[10];
    memset(check,0,sizeof(int)*10);

    //行遍历
    for(int i=0;i<boardSize;i++){
        memset(check,0,sizeof(int)*10);
        for(int j=0;j<*boardColSize;j++){
            if(board[i][j] != '.'){
                int t = (int)(board[i][j] - '0');
                if(check[t]){
                    return false;
                }
                check[t]++;
            }
        }
    }

 //列遍历
        for(int i=0;i<*boardColSize;i++){
        memset(check,0,sizeof(int)*10);
        for(int j=0;j<boardSize;j++){
            if(board[j][i] != '.'){
                int t = (int)(board[j][i] - '0');
                if(check[t]){
                    return false;
                }
                check[t]++;
            }
        }
    }
   
    //宫格遍历
    for(int i=0;i<9;i++){
        int xi_Sudoku = (i % 3) * 3;
        int yi_Sudoku = (i / 3) * 3;
        memset(check,0,sizeof(int)*10);
        for(int m=0;m<3;m++){
            for(int n=0;n<3;n++){
                if(board[xi_Sudoku + m][yi_Sudoku + n] != '.'){
                    int t = (int)(board[xi_Sudoku + m][yi_Sudoku + n] - '0');
                    if(check[t]){
                        return false;
                    }
                    check[t]++;
                }
            }
        }
    }
    return true;
}
```

### 3、解题思路：

需要满足的条件：  
1.每一行无重复数字  
2.每一列无重复数字  
3.每一宫格无重复数字

对于 行/列 无重复数字，我们可以将每一 行/列 每个数字出现的次数记录下来  
当同一 行/列 中同一数字出现一次以上则返回`false`

对于每一个子宫格也可以做类似处理，所以只需要解决怎么将子宫格逐个划分的问题就可以啦~

### 4、关键语句分析：

##### 1、

```c
    int check[10];
    memset(check,0,sizeof(int)*10);
```

`check`用于记录数字1-9出现的次数，数组下标代表数字，存放的值代表次数，0号单元不用  
`memset`使用时需要包含头文件`string.h`，它的作用是给`check`的`sizeof(int)*10`个整型空间赋值`0`

##### 2、

```c
 //行/列遍历
    for(int i=0;i<boardSize;i++){
        memset(check,0,sizeof(int)*10);
        for(int j=0;j<*boardColSize;j++){
            if(board[i][j] != '.'){
                int t = (int)(board[i][j] - '0');
                if(check[t]){
                    return false;
                }
                check[t] = 1;
            }
        }
    }
```

将每一 行/列 的标记数组初始化以后便开始将这一 行/列 进行遍历，因为没有填的数字用`'.'`表示，所以我们需要将`char`类型的数字转成`int`类型，并判断该数字是否被标记过，若是返回`false`，若没有被标记，则将该位置标记为`1`。

##### 3、

```c
//宫格遍历
for(int i=0;i<9;i++){
    int xi_Sudoku = (i % 3) * 3;
    int yi_Sudoku = (i / 3) * 3;
    memset(check,0,sizeof(int)*10);
    for(int m=0;m<3;m++){
       for(int n=0;n<3;n++){
           if(board[xi_Sudoku + m][yi_Sudoku + n] != '.'){
               int t = (int)(board[xi_Sudoku + m][yi_Sudoku + n] - '0');
               if(check[t]){
                   return false;
               }
               check[t]++;
           }
       }
    }
}
```

`int xi_Sudoku = (i % 3) * 3;`  
`int yi_Sudoku = (i / 3) * 3;`  
这两句用划分分子宫格的起始位置  
下边两个0-3的`for`循环用于限定子宫格的大小  
在这个题目中相当于将数独划分成了9个小宫格，我们可以通过先找到每个小宫格的起始位置，再利用`for`确定切题的大小解决划分问题。  
其余的标记算法和行/列的大同小异。

## 二、矩阵置零

### 1、题目：

**给定一个 m x n 的矩阵，如果一个元素为 0 ，则将其所在行和列的所有元素都设为 0 。**

### 2、代码如下：

```c
void setZeroes(int** matrix, int matrixSize, int* matrixColSize){
    int check_row[matrixSize];
    int check_col[*matrixColSize];
    memset(check_row,0,sizeof(int)*matrixSize);
    memset(check_col,0,sizeof(int)*(*matrixColSize));
    //遍历并标记
    for(int i=0;i<matrixSize;i++){
        for(int j=0;j<(*matrixColSize);j++){
            if(matrix[i][j] == 0){
                check_row[i] = 1;
                check_col[j] = 1;
            }
        }
    }
    //条件清零
    for(int i=0;i<matrixSize;i++){
        for(int j=0;j<(*matrixColSize);j++){
            if(check_col[j] || check_row[i])
            matrix[i][j] = 0;
        }
    }
}
```

### 3、解题思路：

先遍历一遍数组将存在`0`的所在行和列全部标记下来  
再遍历一遍数组将标记位置清零

### 4、关键语句分析：

##### 1、

```c
    int check_row[matrixSize];
    int check_col[*matrixColSize];
    memset(check_row,0,sizeof(int)*matrixSize);
    memset(check_col,0,sizeof(int)*(*matrixColSize));
```

创建标记数组并初始化清零，和上一题类似

##### 2、

```c
//遍历并标记
for(int i=0;i<matrixSize;i++){
        for(int j=0;j<(*matrixColSize);j++){
            if(matrix[i][j] == 0){
                check_row[i] = 1;
                check_col[j] = 1;
            }
        }
    }
```

##### 3、

```c
 //条件清零
    for(int i=0;i<matrixSize;i++){
        for(int j=0;j<(*matrixColSize);j++){
            if(check_col[j] || check_row[i])
            matrix[i][j] = 0;
        }
    }
```

这里其实是通过遍历标记数组对目标矩阵进行清零  
既 如果该元素所在的行或列被标记时，就执行清零操作。
