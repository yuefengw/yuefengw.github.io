---
title: "Day1：【LeetCode-三周攻克数据结构 】题目分析笔记（C语言）"
slug: leetcode-data-structure-day-1
date: 2022-01-08 15:45:00
updated: 2022-01-08 15:45:00
categories:
  - "算法"
  - "LeetCode"
tags:
  - "LeetCode"
  - "数据结构"
  - "C"
cover: /images/posts/backend-cover.webp
description: "本文探讨了如何利用快速排序算法检测整数数组中的重复元素，并通过滑动窗口技巧求解最大子数组和问题。通过实例代码展示了C语言实现及关键步骤解析。"
original_url: "https://blog.csdn.net/qq_41725967/article/details/122379281"
original_platform: CSDN
---

本文探讨了如何利用快速排序算法检测整数数组中的重复元素，并通过滑动窗口技巧求解最大子数组和问题。通过实例代码展示了C语言实现及关键步骤解析。

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/122379281)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

## 一、存在重复元素

### 1、题目：

**给定一个整数数组，判断是否存在重复元素。如果存在一值在数组中出现至少两次，函数返回 true 。如果数组中每个元素都不相同，则返回 false 。**

### 2、代码如下：

```c
int cmp(const void* _a, const void* _b) {
    int a = *(int*)_a, b = *(int*)_b;
    return a-b;
}

bool containsDuplicate(int* nums, int numsSize){
	qsort(nums,numsSize,sizeof(int),cmp);
    for(int i=0;i<numsSize-1;i++){
        if(nums[i]==nums[i+1])
        return true;
    }
    return false;
}
```

### 3、解题思路：

利用快速排序将数组排序，比较相邻两个位置的数据，相等则返回true。

### 4、关键语句分析：

```c
qsort(nums,numsSize,sizeof(int),cmp);
```

`qsort`为C自带快排函数，使用时需要包含 `stdlib.h`  
`nums`数组首地址  
`numsSize`数组长度  
`sizeof()`数组中单个元素的大小  
`cmp`排序方式

```c
int cmp(const void* _a, const void* _b) {
    int a = *(int*)_a, b = *(int*)_b;
    return a - b;
}
```

`cmp`为比较函数  
`return a-b;`时为从小到大排序  
`return b-a;`时为从大到小排序

## 二、最大子数组和

### 1、题目：

**给你一个整数数组`nums`,请你找出一个具有最大和的连续子数组(子数组最少包含一个元素),返回其最大和。子数组是数组中的一个连续部分。**

### 2、代码如下：

```c
int maxSubArray(int* nums, int numsSize){
    int f[numsSize];
    int i,temp,max;
    f[0] = nums[0];
    for(i=1;i<numsSize;i++){
        temp = f[i-1]+nums[i];
        if(temp>=nums[i])
            f[i] = temp;
        else
            f[i] = nums[i];
    }
    max = f[0];
    for(i=1;i<numsSize;i++){
        if(f[i]>max)
        max = f[i];
    }
    return max;
}
```

### 3、解题思路：

创建一个新的数组`f[i]`用于存放前i个数据中最大连续子数组的值  
当`nums[i]+f[i-1]`的值**大于**`nums[i]`时，我们认为第i个与前边的是可连续的  
既`f[i]`不会比`nums[i]`还小  
此时将`nums[i]+f[i-1]`也就是temp存入`f[i]`  
当`nums[i]+f[i-1]`的值**小于**`nums[i]`时，我们认为第i个与前边的是不可连续  
既i这个位置成为了一个断点，后边的从这里开始重新累计。  
`f[i]`创建完成以后只需要从中选出一个最大值就ok啦~

### 4、关键语句分析：

```c
//创建数组f[i]用于存放前i个数据中最大连续子数组的值
 for(i=1;i<numsSize;i++){
        temp = f[i-1]+nums[i];
        if(temp>=nums[i])
            f[i] = temp;
        else
            f[i] = nums[i];
    }
```

`temp`用于存放`nums[i]+f[i-1]`  
当`temp`\>=`nums[i]`（可连续时）存入`f[i]`  
不可连续时就把`nums[i]`存入`f[i]`,从这个位置重新累计。
