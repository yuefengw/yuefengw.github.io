---
title: "Day2：【LeetCode-三周攻克数据结构 】题目分析笔记（C语言）"
slug: leetcode-data-structure-day-2
date: 2022-01-09 19:17:27
updated: 2022-01-09 19:17:27
categories:
  - "算法"
  - "LeetCode"
tags:
  - "数据结构"
  - "LeetCode"
  - "C"
cover: /images/posts/backend-cover.webp
description: "本文介绍了两道编程题目的解决方法，一是寻找数组中和为目标值的两个整数并返回其下标；二是合并两个有序数组并保持非递减顺序。通过具体代码实现展示了基本的算法思想。"
original_url: "https://blog.csdn.net/qq_41725967/article/details/122397289"
original_platform: CSDN
---

本文介绍了两道编程题目的解决方法，一是寻找数组中和为目标值的两个整数并返回其下标；二是合并两个有序数组并保持非递减顺序。通过具体代码实现展示了基本的算法思想。

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/122397289)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

## 一、两数之和

### 1、题目：

**给定一个整数数组 nums 和一个整数目标值 target，请你在该数组中找出 和为目标值 target 的那两个整数，并返回它们的数组下标。你可以假设每种输入只会对应一个答案。但是，数组中同一个元素在答案里不能重复出现。**

### 2、代码如下：

```c
int* twoSum(int* nums, int numsSize, int target, int* returnSize){
    *returnSize = 2;
    int *ans=(int*)malloc(sizeof(int)*returnSize);
    int i,j;
    for(i=0;i<numsSize;i++){
        for(j=i+1;j<numsSize;j++){
            if(nums[i]+nums[j] == target){
                ans[0] = i;
                ans[1] = j;
                return ans;
            }
        }
    }
    return 0;
}
```

### 3、解题思路：

因为我还是小白刚上路，而且没有时间限制，能暴力的直接暴力，两层`for`循环就出来啦~

### 4、关键语句分析：

##### 1、

```c
int *ans=(int*)malloc(sizeof(int)*returnSize);
```

`malloc`是开辟空间用的，因为函数体内定义的东西运行结束会自动清理，所以需要给返回的数组开辟一段空间  
`ans`为返回数组的首地址

##### 2、

```c
for(i=0;i<numsSize;i++){
        for(j=i+1;j<numsSize;j++){
            if(nums[i]+nums[j] == target){
                ans[0] = i;
                ans[1] = j;
                return ans;
            }
        }
    }
}
```

两层`for`循环

## 二、合并两个有序数组

### 1、题目：

**给你两个按非递减顺序排列的整数数组 nums1 和 nums2，另有两个整数 m 和 n ，分别表示 nums1 和 nums2 中的元素数目。请你合并 nums2 到 nums1 中，使合并后的数组同样按非递减顺序排列。**

**注意：最终，合并后数组不应由函数返回，而是存储在数组 nums1 中。为了应对这种情况，nums1 的初始长度为 m + n，其中前 m 个元素表示应合并的元素，后 n 个元素为 0 ，应忽略。nums2 的长度为 n 。**

### 2、代码如下：

```c
int cmp(const void *_a,const void *_b){
    int a = *(int*)_a,b = *(int*)_b;
    return a - b;
}

void merge(int* nums1, int nums1Size, int m, int* nums2, int nums2Size, int n){
    for(int i=m,j=0;i<m+n;i++,j++){
        nums1[i] = nums2[j];
    }
    qsort(nums1,(m+n),sizeof(int),cmp);
}
```

### 3、解题思路：

直接将`nums2`中的元素复制到`nums1`中，然后利用快排实现非递减顺序排序。

### 4、关键语句分析：

##### 1、

```c
qsort(nums1,(m+n),sizeof(int),cmp);
```

##### 2、

```c
int cmp(const void *_a,const void *_b){
    int a = *(int*)_a,b = *(int*)_b;
    return a - b;
}
```

以上两个模块Day1中已经做出解释，[点击这里移步查看。](https://blog.csdn.net/qq_41725967/article/details/122379281?spm=1001.2014.3001.5501).
