import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(137,129,229,0.5)] focus-visible:ring-offset-1 focus-visible:ring-offset-[#1e1f2a] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        /* Agentone chip style — dark purple-tinted pill, used for all primary actions */
        default:     'bg-[rgba(39,34,51,0.85)] border border-[rgba(153,156,179,0.4)] text-[#e8e9f2] hover:bg-[rgba(39,34,51,1)] hover:border-[rgba(137,129,229,0.65)]',
        destructive: 'bg-[rgba(237,95,86,0.12)] border border-[rgba(237,95,86,0.35)] text-[#ed5f56] hover:bg-[rgba(237,95,86,0.2)]',
        outline:     'border border-[rgba(77,79,99,0.4)] bg-transparent text-[#8f91a1] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#e8e9f2] hover:border-[rgba(153,156,179,0.55)]',
        secondary:   'bg-[rgba(39,34,51,0.6)] border border-[rgba(77,79,99,0.3)] text-[#c4c5d4] hover:bg-[rgba(39,34,51,0.85)]',
        ghost:       'text-[#8f91a1] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#e8e9f2]',
        link:        'text-[#8981e5] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm:      'h-9 rounded-md px-3 text-xs',
        lg:      'h-11 rounded-md px-8',
        icon:    'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
