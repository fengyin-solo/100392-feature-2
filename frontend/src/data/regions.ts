// 值班区域选项：县局可以动全部乡镇的数据，乡镇人员只能动本乡镇。
// 隐患点种子数据里的「所在乡镇」也从这里取，保证权限判断能对上号。
export const COUNTY_REGION = '县局'

export const REGION_OPTIONS: string[] = [COUNTY_REGION, '城关镇', '青云镇', '石门乡', '溪口镇']
