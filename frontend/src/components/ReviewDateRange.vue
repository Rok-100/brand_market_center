<script setup lang="ts">
import { computed, ref } from 'vue'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
const props = defineProps<{ start: string; end: string }>()
const emit = defineEmits<{ 'update:start': [string]; 'update:end': [string] }>()
const open = ref(false)
const selecting = ref<'start'|'end'>('start')
const month = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const title = computed(() => `${month.value.getFullYear()}年 ${month.value.getMonth()+1}月`)
const days = computed(() => {
  const first = new Date(month.value); first.setDate(1-(first.getDay()+6)%7)
  return Array.from({length:42}, (_,i) => { const d=new Date(first);d.setDate(first.getDate()+i);return {value:key(d), day:d.getDate(), current:d.getMonth()===month.value.getMonth()} })
})
const show = (part:'start'|'end') => { selecting.value=part; const selected=part==='start'?props.start:props.end; if(selected) {const d=new Date(selected+'T12:00:00');month.value=new Date(d.getFullYear(),d.getMonth(),1)};open.value=true }
const move = (offset:number) => { month.value=new Date(month.value.getFullYear(),month.value.getMonth()+offset,1) }
const choose = (value:string) => {
  if(selecting.value==='start') {emit('update:start',value);if(props.end && value>props.end)emit('update:end','');selecting.value='end'}
  else if(props.start && value<props.start) {emit('update:start',value);emit('update:end','');selecting.value='end'}
  else {emit('update:end',value);open.value=false}
}
const preset = (days:number) => {const end=new Date();const start=new Date();start.setDate(start.getDate()-days);emit('update:start',key(start));emit('update:end',key(end));open.value=false}
const clear = () => {emit('update:start','');emit('update:end','');open.value=false}
</script>
<template>
  <div class="review-range" @keydown.esc.stop="open=false">
    <div class="range-field"><CalendarDays/><button type="button" aria-label="选择提交开始日期" :aria-expanded="open && selecting==='start'" @click="show('start')">{{ start || '开始日期' }}</button><span>至</span><button type="button" aria-label="选择提交结束日期" :aria-expanded="open && selecting==='end'" @click="show('end')">{{ end || '结束日期' }}</button><button v-if="start || end" class="clear" type="button" aria-label="清除日期筛选" @click="clear"><X/></button></div>
    <div v-if="open" class="range-calendar" role="dialog" aria-label="提交日期范围日历">
      <header><strong>{{ selecting==='start'?'选择开始日期':'选择结束日期' }}</strong><button type="button" aria-label="关闭日期日历" @click="open=false"><X/></button></header>
      <div class="month"><button type="button" aria-label="上个月" @click="move(-1)"><ChevronLeft/></button><strong>{{ title }}</strong><button type="button" aria-label="下个月" @click="move(1)"><ChevronRight/></button></div>
      <div class="days"><span v-for="day in ['一','二','三','四','五','六','日']" :key="day">{{ day }}</span><button v-for="day in days" :key="day.value" type="button" :aria-label="day.value" :aria-pressed="day.value===start || day.value===end" :class="{ outside:!day.current,selected:day.value===start || day.value===end,between:start && end && day.value>start && day.value<end }" @click="choose(day.value)">{{ day.day }}</button></div>
      <footer><button type="button" @click="preset(0)">今天</button><button type="button" @click="preset(6)">最近7天</button><button type="button" @click="clear">不限日期</button></footer><small>按提交日期筛选，包含结束日期全天；选好后点击“查询”。</small>
    </div>
  </div>
</template>
<style scoped>
.review-range{position:relative;flex:none;color:#526174}.range-field{display:flex;align-items:center;gap:8px;height:36px;padding:0 9px;border:1px solid #cbdde8;border-radius:6px;background:#fff}.range-field>svg{width:15px;height:15px;color:#8b9bb0}.review-range button{font-family:inherit;font-size:12px;cursor:pointer;background:white;color:#526174;border:0}.range-field>button{min-width:100px;height:32px;padding:0 6px}.range-field>span{font-size:12px;color:#8b98a8}.range-field>.clear{min-width:20px;padding:0}.clear svg{width:14px;height:14px}.range-calendar{position:absolute;top:44px;left:0;z-index:30;width:300px;padding:14px;background:#fff;border:1px solid #dce5ef;border-radius:10px;box-shadow:0 10px 35px #1b3d6826}.range-calendar header,.month{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.range-calendar header{font-size:13px}.range-calendar svg{width:16px;height:16px}.range-calendar header button,.month button{display:grid;place-items:center;width:28px;height:28px;min-width:0}.month{font-size:13px}.days{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}.days>span{font-size:12px;color:#8c97a7;padding:5px}.days>button{height:30px;min-width:0;border-radius:5px;padding:0}.days>button:hover{background:#e9f2ff}.days>button.outside{color:#b9c1cd}.days>button.selected{background:#0864d6;color:white}.days>button.between{background:#edf4ff;color:#0864d6}.range-calendar footer{display:flex;gap:12px;border-top:1px solid #e7ecf3;margin-top:12px;padding-top:10px}.range-calendar footer button{color:#0864d6;min-width:0;padding:4px}.range-calendar small{display:block;font-size:11px;color:#8c97a7;margin-top:9px}.review-range button:focus-visible{outline:2px solid #3689dc;outline-offset:2px}
@media(max-width:450px){.range-calendar{width:270px;left:-8px}.range-field>button{min-width:90px}}
</style>
