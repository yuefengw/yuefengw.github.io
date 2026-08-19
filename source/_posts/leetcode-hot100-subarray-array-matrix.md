---
title: "【力扣LeetCode热题h100】子串、普通数组、矩阵"
slug: leetcode-hot100-subarray-array-matrix
date: 2026-04-10 18:26:16
updated: 2026-04-10 18:26:27
categories:
  - "算法"
  - "LeetCode"
tags:
  - "LeetCode"
  - "矩阵"
  - "算法"
cover: /images/posts/backend-cover.webp
description: "本文总结了LeetCode热题中的子串相关题目，包括滑动窗口和前缀和等解法。重点介绍了三个典型问题：1）和为K的子数组，通过前缀和+哈希表统计满足条件的子数组个数；2）滑动窗口最大值，使用优先队列或单调队列高效获取每个窗口的最大值；3）最小覆盖子串，通过滑动窗口和哈希表寻找覆盖目标字符串的最小子串。这些题目考察了数组处理、滑动窗口优化等技巧，在笔试面试中频繁出现，具有重要参考价值。"
original_url: "https://blog.csdn.net/qq_41725967/article/details/157477600"
original_platform: CSDN
---

本文总结了LeetCode热题中的子串相关题目，包括滑动窗口和前缀和等解法。重点介绍了三个典型问题：1）和为K的子数组，通过前缀和+哈希表统计满足条件的子数组个数；2）滑动窗口最大值，使用优先队列或单调队列高效获取每个窗口的最大值；3）最小覆盖子串，通过滑动窗口和哈希表寻找覆盖目标字符串的最小子串。这些题目考察了数组处理、滑动窗口优化等技巧，在笔试面试中频繁出现，具有重要参考价值。

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/157477600)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

## 子串

### 10\. 和为K的子数组

**题目**：  
给你一个整数数组 nums 和一个整数 k ，请你统计并返回 该数组中和为 k 的子数组的个数 。  
子数组是数组中元素的连续非空序列。  
**代码：**

```c
class Solution {
public:
    int subarraySum(vector<int>& nums, int k) {
        unordered_map<int, int> mp;
        int ans=0;
        int pre=0;
        mp[0]=1;
        for(int i=0; i<nums.size(); i++){
            pre += nums[i];
            if(mp.find(pre-k) != mp.end())
                ans += mp[pre-k];
            mp[pre]++;
        }
        return ans;
    }
};
```

```java
class Solution { // java 代码
    public int subarraySum(int[] nums, int k) {
        // 和为k的子数组
        // 前缀和 要看当前前缀和-k 在之前前缀和中出现了几次 即为几个子数组
        HashMap<Integer, Integer> map = new HashMap<>();
        map.put(0, 1);

        int pre = 0;
        int ans = 0;
        for(int x : nums){
            pre += x;
            if(map.containsKey(pre-k)){
                ans += map.get(pre-k);
            }
            map.put(pre, map.getOrDefault(pre, 0)+1);
        }
        return ans;
    }
}
```

**分析**：

-   两个节点`j, i`, p r e i pre\_i prei​用于记录含当前节点`i`之前的所有元素和， p r e j pre\_j prej​用于记录含当前节点`j`之前的所有元素和
-   若`[j, ..., i]`这一段的和为k，则满足 p r e i − p r e j − 1 = = k pre\_i - pre\_{j-1} == k prei​−prej−1​==k，即 p r e i − k = = p r e j − 1 pre\_i - k== pre\_{j-1} prei​−k==prej−1​
-   比较隐藏的一个点：因为数组中存在负数，这个 p r e j − 1 pre\_{j-1} prej−1​可能出现多次，也就是在不同的`j`处， p r e j − 1 pre\_{j-1} prej−1​这个数可能是相同的，表示从不同的起始点`j`到当前点的子数组和为`k`的不同情况
-   举个特殊例子：`[1，-1，1，1]， k=2` 对于这个例子，当`i=3`的时候，可取的`j=0，2`，也就是`nums[0-3]，nums[2-3]`满足题目要求  
    **总结**
-   `mp.find(pre-k) != mp.end()`记住找不到是这样表示的

* * *

### 11\. 滑动窗口最大值

***hard***  
**题目**：  
给你一个整数数组 nums，有一个大小为 k 的滑动窗口从数组的最左侧移动到数组的最右侧。你只可以看到在滑动窗口内的 k 个数字。滑动窗口每次只向右移动一位。  
返回 滑动窗口中的最大值 。

**代码：优先队列**

```c
class Solution {
public:
    vector<int> maxSlidingWindow(vector<int>& nums, int k) {
       priority_queue<pair<int, int>> q;
       for(int i=0; i<k; i++)
            q.emplace(nums[i], i);
        vector<int> ans;
        ans.push_back(q.top().first);
        for(int i=k; i<nums.size(); i++){
            q.emplace(nums[i],i);
            while(q.top().second <= i-k)
                q.pop();
            ans.push_back(q.top().first);  
        }
        return ans;
    }
};
```

**分析**：

-   维护一个优先队列，存储元素和其对应的下标，元素利用优先队列堆的性质找出窗口中的最大值，下标用于判断当前队首（堆顶）的元素是否还在窗口之内

**代码：单调队列**

```c
class Solution {
public:
    vector<int> maxSlidingWindow(vector<int>& nums, int k) {
        deque<int> q;
        int n=nums.size();
        vector<int> ans;
        for(int i=0; i<k; i++){
        	// 新来的如果比队伍后面那几个都优秀 后面的就可以滚蛋了
            while(!q.empty() && nums[i]>=nums[q.back()])
                q.pop_back();
            q.push_back(i);
        }
        ans.push_back(nums[q.front()]);

        for(int i=k; i<n; i++){
            while(!q.empty() && nums[i]>=nums[q.back()])
                q.pop_back();
            q.push_back(i);
             // 老人年龄超出范围的 也可以滚蛋了
            while(q.front()<= i-k)
                q.pop_front();
            ans.push_back(nums[q.front()]);
        }
        return ans;
    }
};
```

```java
class Solution { // java代码
    public int[] maxSlidingWindow(int[] nums, int k) {
        // 滑动串口最大值
        // 队列 first是 先入队的队头 last 是新入队的队尾
        // 过期的不要 新元素加入时比他小的都不要
        int n = nums.length;
        Deque<Integer> q = new ArrayDeque<>();
        int[] ans = new int[n-k+1];

        for(int i=0; i<n; i++){
            while(!q.isEmpty() && nums[i]>nums[q.getLast()]){
                q.removeLast();
            }
            q.addLast(i);
            int left = i-k+1;
            if(q.getFirst() < left){
                q.removeFirst();
            }
            if(left>=0){
                ans[left] = nums[q.getFirst()];
            }  
        }
        return ans;
    }
}
```

**分析**：

-   一道可以联系生活实际的题目：窗口代表公司需要的这么些人，这些人站一队，年纪大的在前面，年纪小的在后面（年纪代表数组下标），秋招开始了，当新面试的人能力比队列中后面那几个年轻人能力还强的时候，后面的被裁，新面试的人入队，当前面的年纪大的超出年纪限制（不在窗口内）的时候，虽然你可能很强，但是对不起，也要强制离场
-   具体细节不再深究了，毕竟现实世界就是这样的

**总结**

-   vivo笔试、字节一面出现过的题，我们在优化算法的同时也正被资本优化着，但是无论如何，加油吧！

* * *

### 12\. 最小覆盖子串

***hard***  
**题目**：  
给你一个字符串 s 、一个字符串 t 。返回 s 中涵盖 t 所有字符的最小子串。如果 s 中不存在涵盖 t 所有字符的子串，则返回空字符串 “” 。  
**代码：滑动窗口**

```c
class Solution {
    bool is_covered(int cnts[], int cntt[]){
        for(int i='a'; i<='z'; i++)
            if(cnts[i] < cntt[i])
                return false;
        
        for(int i='A'; i<='Z'; i++)
            if(cnts[i] < cntt[i])
                return false;

        return true;
    }
public:
    string minWindow(string s, string t) {
        int m=s.size();
        int cnts[128]{};
        int cntt[128]{};
        for(char c : t)
            cntt[c]++;
        int ansl=-1, ansr=m-1;
        int left=0;
        for(int right=0; right<m; right++){
            cnts[s[right]]++;
            while(is_covered(cnts, cntt)){
                if(ansr-ansl > right-left){
                    ansl=left;
                    ansr=right;
                }
                cnts[s[left]]--;
                left++;
            }
        }
        return ansl==-1 ? "" : s.substr(ansl, ansr-ansl+1);
    }
};
```

**分析**：

-   两个cnt数组用于存储t子串每个字母出现的次数和当前子串每个字母出现的次数
-   右指针往后走为了使目标子串出现，左指针往右收缩为了获取当前子串下的最小长度
-   当获得了第一个可能的最小长度子串后，重复上述步骤，这个过程中根据子串长度更新ansl，ansr

**代码：优化滑动窗口**

```c
class Solution {
public:
    string minWindow(string s, string t) {
        int m=s.size();
        int ansl=-1, ansr=m;
        int cnt[128]{};
        int less=0;
        for(char c:t){
            if(cnt[c] ==0)
                less++; //记录还有多少个不够个数的
            cnt[c]++;
        }
             
        int left=0;
        for(int right=0; right<m; right++){
            char c=s[right];
            cnt[c]--;
            if(cnt[c] == 0)
                less--;
            while(less == 0){
                if(ansr-ansl>right-left){
                    ansl = left;
                    ansr = right;
                }
                char x = s[left];
                if(cnt[x] == 0)
                    less++;
                cnt[x]++;
                left++;
            }
        }
        return ansl==-1 ? "" : s.substr(ansl, ansr-ansl+1);
    }
};
```

```java
class Solution {
    public String minWindow(String s, String t) {
        int m = s.length();
        // ansr 初始化为 m (一个无效的大索引，方便比较长度)
        // ansl 初始化为 -1 代表没找到
        int ansl = -1, ansr = m;
        
        int[] cnt = new int[128];
        int less = 0; // 记录还有多少“种”字符没凑齐

        // 1. 初始化需求
        for (char c : t.toCharArray()) {
            if (cnt[c] == 0) {
                less++; // 如果是新出现的字符种类，less + 1
            }
            cnt[c]++;
        }

        int left = 0;
        // 2. 滑动窗口
        for (int right = 0; right < m; right++) {
            char c = s.charAt(right);
            cnt[c]--; // 进窗，数量减 1
            
            // 如果减完刚好归零，说明这一“种”字符凑齐了
            if (cnt[c] == 0) {
                less--;
            }

            // 3. 当所有种类都凑齐时 (less == 0)，尝试收缩
            while (less == 0) {
                // 更新最小子串 (注意：C++代码里 right 是当前索引，Java计算长度要小心)
                // 原代码：ansr - ansl > right - left
                // right - left 是当前窗口长度减 1 (因为 right 是闭区间)
                // 这里我们直接比较长度
                if (ansr - ansl > right - left) {
                    ansl = left;
                    ansr = right;
                }

                char x = s.charAt(left);
                // 准备移出左边界 x
                // 如果 cnt[x] 是 0，说明移出前是“刚刚好”，移出后就“缺货”了
                if (cnt[x] == 0) {
                    less++;
                }
                cnt[x]++; // 还原计数
                left++;   // 左指针右移
            }
        }

        // Java 的 substring 是左闭右开 [start, end)
        // ansl 是起点，ansr 是终点(包含)，所以 substring 的第二个参数要是 ansr + 1
        return ansl == -1 ? "" : s.substring(ansl, ansr + 1);
    }
}
```

**分析**：

-   优化`cnt`，初始化时和上面的cntt进行一样的操作，记录每个目标字母出现的次数；`less`初始用于记录字符串`t`中有多少个不同的字母，或者说是当前子串中还有多少个字母的数量不满足要求；具体而言，后续right每向右移动的过程中，如果移动进来的是`t`中的字母，则消化掉`cnt`对应位置的一个元素，当新来的x字母不属于`t`中，`cnt[x]--`就变成负的了，当新来的x字母属于t中，`cnt[x]--`可能变为0或者大于0（因为t中相同字母可能重复出现），当变成0的时候说明当前子串字母x的个数和目标串字母x的个数相等，此时`less--`，表示当前子串中还差`less`个才能满足要求
-   `less==0`后，根据条件压缩边界，右边移动完了现在收缩左边，当左侧字母x的`cnt[x]==0`，说明这个字母移动出去之后当前子串不满足了，也就是还差一个满足，遂`less++`并将`cnt[x]++`还原回去

**总结**

-   字节一面、深信服笔试中的题，上来就给hard，以后真的要坚持刷题

* * *

## 普通数组

### 13\. 最大子数组和

***中等***  
**题目**：  
给你一个整数数组 nums ，请你找出一个具有最大和的连续子数组（子数组最少包含一个元素），返回其最大和。  
**代码：动态规划**

```c
class Solution {
public:
    int maxSubArray(vector<int>& nums) {
        int n=nums.size();
        vector<int> dp(n);
        dp[0] = nums[0];
        int ans=nums[0];
        for(int i=1; i<n; i++){
            dp[i] = max(dp[i-1]+nums[i], nums[i]);
            ans = max(ans, dp[i]);
        }
        return ans;
    }
};
```

```java
class Solution {
    public int maxSubArray(int[] nums) {
        // 最大子数组和 动态规划 
        int ans = nums[0];
        int pre = 0;

        for(int x : nums){
            pre = Math.max(pre+x, x);
            ans = Math.max(ans, pre);
        }
        return ans;
    }
}
```

**分析**：

-   求解动态规划最难的在于如何将子问题定义出来？题目要求的是最大子数组和，那么子数组如此之多，我们究竟选哪一个呢，或者说从什么特征的数组呢，或者说，我们应该如何选择子数组呢？
-   对了，首先要解决的就是怎么选数组，暴力的解法是遍历所有子数组，比方说现在数组有四个元素，我们就需要遍历4+3+2+1个子数组并求和获得最大值，但这样做似乎会超时，那怎么办？
-   这时候就需要分析问题本身的特点，给定的数组正负数都有，假如都是正数，那么和最大的子数组一定是整个数组，但是但是，数组中存在负数，如果当前`nums[i]`是负数，那么**之前的任意一段以nums\[i-1\]结尾的子数组**加上`nums[i]`都不会更大，等等！！**之前的任意一段以nums\[i-1\]结尾的子数组**？到这里好像有点动态规划的感觉了，从上面的分析可以看出，我们好像是可以计算以每个元素结尾的子数组的最大长度，当计算下一个元素结尾的最大长度时只需要看下一个元素值的正负，正的则在上一个基础上加上当前值，负的则和上一个最大长度相等
-   我们可以用`dp[i]`表示以`nums[i]`结尾所有子数组的最大长度，`dp[0]`当然就是`nums[0]`，以后的每次比较中`dp[i] = max(dp[i-1]+nums[i], nums[i])`，这里的max可以保证我们将之前的某一段出现的最大值保留下来

**总结**

-   之前上课的时候老师直接讲用dp\[i\]记录以nums\[i\]结尾子数组的最大长度，而没有讲明白为什么非得是以nums\[i\]结尾子数组，前面的刷题还是有点用处的，分析题目的特点，根据题目的一些规律，或者说找出题目可以让我们投机取巧的部分（下划线那一部分）是解题的关键

* * *

### 14\. 合并区间

***中等***  
**题目**：  
以数组 intervals 表示若干个区间的集合，其中单个区间为 intervals\[i\] = \[starti, endi\] 。请你合并所有重叠的区间，并返回 一个不重叠的区间数组，该数组需恰好覆盖输入中的所有区间 。  
**代码：**

```c
class Solution {
public:
    vector<vector<int>> merge(vector<vector<int>>& intervals) {
        if(intervals.size()==0)
            return {};
        sort(intervals.begin(), intervals.end());
        vector<vector<int>> ans;
        for(int i=0; i<intervals.size(); i++){
            int l=intervals[i][0], r=intervals[i][1];
            if(!ans.size() || l>ans.back()[1])
                ans.push_back({l, r});
            else
                ans.back()[1] = max(r, ans.back()[1]);
        }
        return ans;
    }
};
```

```java
class Solution {
    public int[][] merge(int[][] intervals) {
        // 合并区间 先根据第一个数排序 再判断两个数组有没有交集
        Arrays.sort(intervals, (p, q) -> p[0]-q[0]);
        List<int[]> ans = new ArrayList<>();
        for(int[] p : intervals){
            int m = ans.size();
            if(m>0 && p[0] <= ans.get(m-1)[1]){
                ans.get(m-1)[1] = Math.max(p[1], ans.get(m-1)[1]);
            }else{
                ans.add(p);
            }
        }
        return ans.toArray(new int[ans.size()][]);
    }
}
```

**分析**：

-   每个子区间有序的情况下，只要左段的右端小于右段的左端就不能合并，这时直接将右段push进去就好
-   其余的情况都能合并，将左段的右端替换更新就好

**总结**

-   快手日常实习一面手撕，终于遇到了一道简单题
-   vector是back,push\_back，队列、栈、优先队列优化构造对象的时候用emplace

* * *

### 15\. 轮转数组

***简单***  
**题目**：  
给定一个整数数组 nums，将数组中的元素向右轮转 k 个位置，其中 k 是非负数。  
**代码：数组翻转**

```c
class Solution {
public:
    void rotate(vector<int>& nums, int k) {
        k %= nums.size();
        reverse(nums.begin(), nums.end()); //[0,n)
        reverse(nums.begin(), nums.begin()+k); //[0,k+1)
        reverse(nums.begin()+k, nums.end()); // [k+1, n)
    }
};
```

```java
class Solution {
    public void rotate(int[] nums, int k) {
        // 轮转数组 类似分治 整体 + 两个局部
        int n = nums.length;
        k %= n;
        reverse(nums, 0, n-1);
        reverse(nums, 0, k-1);
        reverse(nums, k, n-1);
    }

    private void reverse(int[] nums, int i, int j){
        while(i < j){
            int t = nums[i];
            nums[i++] = nums[j];
            nums[j--] = t;
        }
    }
}
```

**分析**：

-   空间为 O ( n ) O(n) O(n)的方法是放到开辟的新数组里面再复制回去：`newArr[(i + k) % n] = nums[i];`
-   空间 O ( 1 ) O(1) O(1)数组翻转：用类似分治的方法先整体反转，再从k位置将原数组分成俩子数组分别反转；假设给定数组为`[1, 2, 3, 4, 5]， k=2` ——> `[5, 4, | 3, 2, 1]` ——> `[4, 5, | 1, 2, 3]`

**总结**

-   指定位置的时候是左闭右开左闭右开左闭右开，sort的也是
-   连着两天简单题，挺开心
-   刚发现2022年竟然做过这道题，欣喜也意外…

* * *

### 16\. 除自身以外数组的乘积

***简单***  
**题目**：  
给你一个整数数组 nums，返回 数组 answer ，其中 answer\[i\] 等于 nums 中除 nums\[i\] 之外其余各元素的乘积 。  
题目数据 保证 数组 nums之中任意元素的全部前缀元素和后缀的乘积都在 32 位 整数范围内。  
请 不要使用除法，且在 O(n) 时间复杂度内完成此题。  
**代码：前缀和**

```c
class Solution {
public:
    vector<int> productExceptSelf(vector<int>& nums) {
        int n=nums.size();
        vector<int> L(n);
        vector<int> R(n);
        vector<int> ans(n);   
        L[0] = 1;
        R[n-1] = 1;
        for(int i=1; i<n; i++)
            L[i] = L[i-1]*nums[i-1];
        for(int i=n-2; i>-1; i--)
            R[i] = R[i+1]*nums[i+1];
        for(int i=0; i<n; i++)
            ans[i] = L[i]*R[i];
        return ans;
    }
};
```

```java
class Solution {
    public int[] productExceptSelf(int[] nums) {
        // 除自身以外数组的乘积 分别计算LR 再乘在一起 三遍扫描
        // O(1): 两遍扫描， R -> L
        int n = nums.length;
        int[] ans = new int[n];
        ans[n-1] = 1;
        for(int i=n-2; i>=0; i--){
            ans[i] = nums[i+1]*ans[i+1];
        }
        int L = 1;
        for(int i=0; i<n; i++){
            ans[i] *= L;
            L *= nums[i];
        }
        return ans;
    }
}
```

**分析**：

-   能上来想到的简单方法：获得数组内所有元素的乘积再除以`nums[i]`，但是数组中出现0这一招就不管用了
-   类似上一题的分段，将问题拆解为左右来看，分别记录`nums[i]`左边和右边所有元素的乘积`L[i]，R[i]`，然后`ans[i]=L[i]*R[i]`，初始化的时候需要注意位置0左边和位置n-1右边的乘积应该是1；时间空间都是 O ( n ) O(n) O(n)
-   空间 O ( 1 ) O(1) O(1)的做法：ans定义完以后可以利用起来记录单边`L[i]`，因为`ans[i]=L[i]*R[i] = ans[i]*R[i] = ans[i]*R;`每个`ans[i]`在被覆盖以前已经被利用，每个位置的R又可以从后往前迭代获得。

**总结**

-   轮转数组和这道题都是需要找一个分解的位置，轮转数组分解的位置是k，这道题是每个nums\[i\]处，然后左右分别来看就好了
-   有点感觉了，加油加油

* * *

### 17\. 缺失的第一个正数

***hard***  
**题目**：  
给你一个未排序的整数数组 nums ，请你找出其中没有出现的最小的正整数。  
请你实现时间复杂度为 O(n) 并且只使用常数级别额外空间的解决方案。  
**代码：**

```c
class Solution {
public:
    int firstMissingPositive(vector<int>& nums) {
        int n = nums.size();				// [1, 2, 2, 2, 3] 当有多个2出现但是nums[2]只能放一个2
        for(int i = 0; i < n; ++i) {		// 当nums[2]已经是2的时侯就不需要再换了 nums[2]是2起标志作用
            while(nums[i] > 0 && nums[i] < n && nums[i] != nums[nums[i] - 1]) {
                swap(nums[i], nums[nums[i] - 1]); // 新换到nums[i]的元素可能也满足要求那就一直交换
            }
        }
        for(int i = 0; i < n; ++i) {
            if(nums[i] != i + 1)
                return i + 1;
        }
        return n + 1;
    }
};
```

```java
class Solution {
    public int firstMissingPositive(int[] nums) {
        // 原地hash 一个萝卜一个坑 必须int j
        int n = nums.length;
        for(int i=0; i<n; i++){
            while(nums[i]>=1 && nums[i]<=n && nums[i]!=nums[nums[i]-1]){
                int j = nums[i]-1;
                int t = nums[i];
                nums[i] = nums[j];
                nums[j] = t;
            }
        }
        for(int i=0; i<n; i++){
            if(nums[i] != i+1){
                return i+1;
            }
        }
        return n+1;
    }
```

**分析**：

-   简单思路：因为找的是缺失的第一个正数，我们可以以此查看1,2,3…n在不在`nums`数组中，返回第一个不在的值，如果都在返回n+1
-   但是这样复杂度不满足要求，每查看一个数在不在数组中都要遍历一遍数组，我们能不能将数组中的元素映射到1,2,3…n的位置呢？映射之后的数组如果位置1的元素是1，说明1在数组中，位置2的元素不是2，说明2不在数组中
-   原地哈希：假设下标从1开始的话，当`nums[i]`不在索引之内，我们不进行处理，在索引之内，那就将`nums[i]`放到位置`nums[nums[i]]`上，为了避免覆盖，这里做交换即可
-   这样从前往后依次遍历，第一个位置i的元素值不是i的i，就是ans，每个元素位置都能对起来的话`ans=n+1`

**总结**

-   其实就是不同大小的萝卜放到不同大小的坑里，坑的数目是有限的，超出范围的萝卜我们不关心，范围内的萝卜放到对应坑大小的位置，最后从左到右看那个坑没放和坑大小对应的萝卜

* * *

## 矩阵

### 18\. 矩阵置零

***简单***  
**题目**：  
给定一个 m x n 的矩阵，如果一个元素为 0 ，则将其所在行和列的所有元素都设为 0 。请使用 原地 算法。  
**代码：**

```c
class Solution {
public:
    void setZeroes(vector<vector<int>>& matrix) {
        int m = matrix.size();
        int n = matrix[0].size();
        vector<int> mm(m), nn(n);
        for(int i=0; i<m; i++)
            for(int j=0; j<n; j++)
                if(matrix[i][j]==0)
                    mm[i] = nn[j] = 1;
        for(int i=0; i<m; i++)
            for(int j=0; j<n; j++)
                if(mm[i] || nn[j])
                    matrix[i][j]=0;
    }
};
```

```java
class Solution {
    public void setZeroes(int[][] matrix) {
        // 矩阵置零 两个标记数组 到 用第一行第一列+两个flag
        int m = matrix.length;
        int n = matrix[0].length;
        boolean flag1 = false;
        boolean flag2 = false;

        for(int i=0; i<m; i++){
            if(matrix[i][0] == 0){
                flag1 = true;
            }
        }

        for(int j=0; j<n; j++){
            if(matrix[0][j] == 0){
                flag2 = true;
            }
        }

        for(int i=1; i<m; i++){
            for(int j=1; j<n; j++){
                if(matrix[i][j] == 0){
                    matrix[i][0] = matrix[0][j] = 0;
                }
            }
        }

        for(int i=1; i<m; i++){
            for(int j=1; j<n; j++){
                if(matrix[i][0]==0 || matrix[0][j]==0){
                    matrix[i][j] = 0;
                }
            }
        }
    if(flag1){
        for(int i=0; i<m; i++){
            matrix[i][0] = 0;
        }
    }

    if(flag2){
        for(int j=0; j<n; j++){
            matrix[0][j] = 0;
        }
    }
    }
}
```

**分析**：

-   `matrix[i][j]==0`时，记录i, j说明i行j列的元素应该置零，再次遍历矩阵的时，查i, j有没有被记录过选择性清零，空间复杂度 O ( m + n ) O(m+n) O(m+n)
-   我想的是用`set`记录i, j，平均空间复杂度 O ( m + n 2 ) O(\\frac{m+n}{2}) O(2m+n​)，嗯，也算进步？
-   空间 O ( 2 ) O(2) O(2)：用矩阵的第一行第一列替代上面的标记数组，也就是将m-1 \* n-1这个小矩阵有零的情况记录在第一行第一列，比方说`matrix[i][j]==0`时，反正所在行列是要被清零的，直接`matrix[i][0] = matrix[0][j] = 0`记录下来，根据记录的情况将小矩阵清零；只剩下第一行第一列没人管了，找两个变量记录这两部分单独处理就好了。 因为 O ( 1 ) = O ( 2 ) O(1)=O(2) O(1)=O(2)，真 O ( 1 ) O(1) O(1)就不看了886~

**总结**

-   优化到极致~

* * *

### 19 螺旋矩阵

***简单***  
**题目**：  
给你一个 m 行 n 列的矩阵 matrix ，请按照 顺时针螺旋顺序 ，返回矩阵中的所有元素。  
**代码：**

```c
class Solution {
public:
    vector<int> spiralOrder(vector<vector<int>>& matrix) {
        int m=matrix.size();
        int n=matrix[0].size();
        int l=0, r=n-1, t=0, b=m-1;
        vector<int> ans;
        while(ans.size() != m*n){
            for(int j=l; j<=r && ans.size()<m*n; j++)
                ans.push_back(matrix[t][j]);
            t++;    
            for(int i=t; i<=b && ans.size()<m*n; i++)
                ans.push_back(matrix[i][r]);
            r--;
            for(int j=r; j>=l && ans.size()<m*n; j--)
                ans.push_back(matrix[b][j]);
            b--;
            for(int i=b; i>=t && ans.size()<m*n; i--)
                ans.push_back(matrix[i][l]);
            l++;
        }
        return ans;
    }
};
```

```java
class Solution {
    public List<Integer> spiralOrder(int[][] matrix) {
        int m = matrix.length;
        int n = matrix[0].length;
        int l = 0;
        int r = n-1;
        int t = 0;
        int b = m-1;
        List<Integer> ans = new ArrayList<>();
        int total = m*n;
        while(ans.size() != total){
            for(int j=l; j<=r&&ans.size()<total; j++){
                ans.add(matrix[t][j]);
            }
            t++;
            for(int i=t; i<=b&&ans.size()<total; i++){
                ans.add(matrix[i][r]);
            }
            r--;
            for(int j=r; j>=l&&ans.size()<total; j--){
                ans.add(matrix[b][j]);
            }
            b--;
            for(int i=b; i>=t&&ans.size()<total; i--){
                ans.add(matrix[i][l]);
            }
            l++;
        }
        return ans;
    }
}
```

**分析**：

-   压缩遍历：由于是顺时针往内海螺一样的遍历，首先想到的就是怎么遍历最外圈？
-   看起来像是：从左上角开始先遍历第一行，再从右上角往下遍历第最后一列，再从右下角往左遍历最后一行，再从左下角往上遍历第一列回到左上角，看起来实现了这些就能循环起来了; 遍历完第一行/列，这一行/列就可以看做是新的边界，那就更新记录四个边界（上t下b左l右r）防止越界访问，每个方向遍历的时候用对应的边界就ok
-   为了防止遍历完最后一个元素后还有for没执行造成越界，每个for里面都判断是否遍历完

**总结**

-   加油加油~

* * *

### 20 旋转图像

***简单***  
**题目**：  
给定一个 n × n 的二维矩阵 matrix 表示一个图像。请你将图像顺时针旋转 90 度。  
你必须在 原地 旋转图像，这意味着你需要直接修改输入的二维矩阵。请不要 使用另一个矩阵来旋转图像。  
**代码1：观察法**

```c
class Solution {
public:
    void rotate(vector<vector<int>>& matrix) {
        int size = matrix.size();
        for (int i = 0; i < size; i++)
            for (int j = 0; j < i; j++)
                swap(matrix[i][j], matrix[j][i]);

        for (int i = 0; i < size; i++)
            for (int j = 0; j < size / 2; j++)
                swap(matrix[i][j], matrix[i][size - 1 - j]);
    }
};
```

**分析**：

-   其实就是先转置再左右翻转

**代码2：推公式**

```c
class Solution {
public:
    void rotate(vector<vector<int>>& matrix) {
        int n=matrix.size();
        for(int i=0; i<n/2; i++){
            for(int j=0; j<(n+1)/2; j++){
                int temp = matrix[i][j];
                matrix[i][j] = matrix[n-1-j][n-1-(n-1-i)];
                matrix[n-1-j][n-1-(n-1-i)] = matrix[n-1-i][n-1-j];
                matrix[n-1-i][n-1-j] = matrix[j][n-1-i];
                matrix[j][n-1-i] = temp;
            }
        }
    }
};
```

```java
class Solution {
    public void rotate(int[][] matrix) {
        // 旋转图像 和模仿一样 找同位置可替代好朋友
        // matrix[i][j] -> matrix[j][n-1-i] -> matrix[n-1-i][n-1-j] -> matrix[n-1-j][n-1-(n-1-i)]
        int n = matrix.length;
        for(int i=0; i<n/2; i++){
            for(int j=0; j<(n+1)/2; j++){
                int t = matrix[i][j];
                matrix[i][j] = matrix[n-1-j][n-1-(n-1-i)];
                matrix[n-1-j][n-1-(n-1-i)] = matrix[n-1-i][n-1-j];
                matrix[n-1-i][n-1-j] = matrix[j][n-1-i];
                matrix[j][n-1-i] = t;
            }
        }
    }
}
```

**分析**：

-   不难发现`matrix[i][j]`旋转完会落到`matrix[j][n-1-i]`，由于是正方形旋转跳四次后必然回到起点成环，也就是matrix\[i\]\[j\]有三个好朋友，他们四个元素顺时针走一步，原地算法的话用temp防覆盖
-   好朋友怎么找？给定模版`matrix[j][n-1-i] = matrix[i][j]`的朋友也很好找了就：
    
    ```c
    matrix[j][n-1-i]  			 	 = matrix[i][j]
    matrix[n-1-i][n-1-j]  			 = matrix[j][n-1-i]；
    matrix[n-1-j][n-1-(n-1-i)]	     = matrix[n-1-i][n-1-j]
    matrix[n-1-(n-1-i)][n-1-(n-1-j)] = matrix[n-1-j][n-1-(n-1-i)]
    ```
    
-   需要遍历那些元素？其实可以将矩阵四分块，每块包含上面等号右边的四个公式所代表的元素，n为偶数时，显然平均分，n为奇数时，矩阵最中间的元素不需要处理，画个3x3的找一下感觉吧~

**总结**

-   评论区说temu社招一面要求用代码2的方式实现，上午脑子晕乎乎的，一点不想看方法2，晚上脑子清醒了发现其实不难

* * *

### 21\. 搜索二维矩阵 II

**题目：**  
编写一个高效的算法来搜索 m x n 矩阵 matrix 中的一个目标值 target 。该矩阵具有以下特性：

-   每行的元素从左到右升序排列。
-   每列的元素从上到下升序排列。

**代码： Z 字形查找**

```c
class Solution {
public:
    bool searchMatrix(vector<vector<int>>& matrix, int target) {
        int m=matrix.size();
        int n=matrix[0].size();
        int x=0, y=n-1;
        while(x<m && y>-1){
            if(matrix[x][y]==target)
                return true;
            else if(matrix[x][y]>target)
                y--;
            else
                x++;
        }
        return false;
    }
};
```

```java
class Solution {
    public boolean searchMatrix(int[][] matrix, int target) {
        // 搜索二位矩阵 右上角开始 排除法
        int m = matrix.length;
        int n = matrix[0].length;
        int i = 0;
        int j = n-1;
        while(i<m && j>=0){
            if(matrix[i][j] == target){
                return true;
            } else if(matrix[i][j] < target){
                i++;
            } else{
                j--;
            }
        }
        return false;
    }
}
```

**分析：**

-   从右上角开始查找，每次向左或者向下移动：
-   当`matrix[x][y] > target`，因为升序，这一列的当前位置及下面都要大于目标值，这一列跳过，`y--`
-   当`matrix[x][y] < target`，说明这一行的当前位置及左边都要小于目标值，遍历下一行`x++`

**总结：**

-   难在不知道要从右上角开始找，左上右下是最大最小，往哪个方向走都是相同的单调性
-   举一反一：试了一下左下角也可以作为起点

* * *
